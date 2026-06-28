#!/usr/bin/env bash
# Builds the patched Freematics telelogger firmware inside Docker.
# Steps:
#   1. Clone Freematics repo (pinned commit) into /firmware/repo.
#   2. Copy overlay files into firmware_v5/telelogger/.
#   3. sed-patch telelogger.ino to #include serial_handler.h and call processSerial(cfg).
#   4. Run pio run -e esp32dev (and pio test -e native for host tests).
set -euo pipefail

FW_DIR="/firmware"
REPO_DIR="${FW_DIR}/repo"
OVERLAY_DIR="${FW_DIR}/overlay"
TELELOGGER_DIR="${REPO_DIR}/firmware_v5/telelogger"
FREEMATICS_REF="${FREEMATICS_REF:-master}"

echo "==> [1/4] Cloning Freematics repo (ref=${FREEMATICS_REF})"
if [ ! -d "${REPO_DIR}/.git" ]; then
  git clone --depth 1 --branch "${FREEMATICS_REF}" https://github.com/stanleyhuangyc/Freematics.git "${REPO_DIR}"
else
  echo "    repo already cloned, skipping"
fi

echo "==> [2/4] Copying overlay files into telelogger dir"
cp -v "${OVERLAY_DIR}/configstore.h"     "${TELELOGGER_DIR}/"
cp -v "${OVERLAY_DIR}/configstore.cpp"   "${TELELOGGER_DIR}/"
cp -v "${OVERLAY_DIR}/serial_handler.h"  "${TELELOGGER_DIR}/"
cp -v "${OVERLAY_DIR}/serial_handler.cpp" "${TELELOGGER_DIR}/"
# Append our build_flags to the telelogger's own platformio.ini (src_dir=.).
if ! grep -q 'ENABLE_SERIAL_CMD' "${TELELOGGER_DIR}/platformio.ini"; then
  printf '\n; --- Freematics Config Manager overlay ---\nbuild_flags = -DENABLE_SERIAL_CMD=1 -DCONFIG_MODE_TIMEOUT=0\n' \
    >> "${TELELOGGER_DIR}/platformio.ini"
fi

echo "==> [3/4] Patching telelogger.ino to call processSerial(cfg)"
INO="${TELELOGGER_DIR}/telelogger.ino"
if ! grep -q 'serial_handler.h' "${INO}"; then
  sed -i '0,/^#include/{/^#include/a #include "serial_handler.h"
}' "${INO}"
fi
# Add a global Config cfg; after the includes (before first function/define).
if ! grep -q 'Config cfg;' "${INO}"; then
  sed -i '/#include "serial_handler.h"/a Config cfg;' "${INO}"
fi
# Insert processSerial(cfg) as first statement inside loop() body.
# loop() spans multiple lines: "void loop()\n{\n  // error handling". We insert
# after the opening brace of loop() by addressing the line after "void loop()".
if ! grep -q 'processSerial(cfg)' "${INO}"; then
  awk 'BEGIN{ins=0} /^void loop\(\)/{print; ins=1; next} ins==1 && /^\{/{print; print "  processSerial(cfg);"; ins=0; next} {print}' \
    "${INO}" > "${INO}.tmp" && mv "${INO}.tmp" "${INO}"
fi
# Insert the config-window guard right after processSerial(cfg);. While a config
# command is active, skip the telemetry/upload work (process()/standby) so the
# shared UART stays quiet and config replies are prompt. Live queries don't open
# the window, so telemetry keeps running during live-data polling.
if ! grep -q 'fcmInConfig' "${INO}"; then
  awk '/processSerial\(cfg\);/{print; print "  if (fcmInConfig()) { delay(2); return; }"; next} {print}' \
    "${INO}" > "${INO}.tmp" && mv "${INO}.tmp" "${INO}"
fi
# Insert a keep-awake guard at the top of the !STATE_WORKING branch so a
# connected configurator prevents standby(). Without it, a device with no OBD,
# sitting still, enters standby()->waitMotion(-1) and blocks forever, killing
# serial. fcmAwake() is refreshed by every command (and the app's keep-alive),
# so the device only sleeps once the host disconnects.
if ! grep -q 'fcmAwake' "${INO}"; then
  awk '/if \(!state\.check\(STATE_WORKING\)\) \{/{print; print "    if (fcmAwake()) { delay(5); return; }"; next} {print}' \
    "${INO}" > "${INO}.tmp" && mv "${INO}.tmp" "${INO}"
fi
echo "    patched telelogger.ino:"
grep -n 'serial_handler.h\|Config cfg\|processSerial\|fcmInConfig' "${INO}" || true

# Append the live-telemetry hook. This strong fcmLiveQuery() overrides the weak
# default in serial_handler.cpp; placed at the end of telelogger.ino so the live
# globals declared near its top (batteryVoltage, rssi, netop, gd, vin,
# teleClient) and types (GPS_DATA, String) are in scope. If a global name ever
# changes upstream the ESP32 build fails loudly here rather than silently
# shipping zeros — but the weak default keeps host tests/un-patched builds green.
if ! grep -q 'fcmLiveQuery' "${INO}"; then
  cat >> "${INO}" <<'LIVEHOOK'

// --- Freematics Config Manager: live telemetry hook (appended by build.sh) ---
// Returns the current reading for a live query key, or "N/A" if unavailable.
String fcmLiveQuery(const String& key) {
  if (key == "BATT")   return batteryVoltage > 0 ? String(batteryVoltage, 1) : String("N/A");
  if (key == "RSSI")   return rssi ? String((int)rssi) : String("N/A");
  if (key == "VIN")    return vin[0] ? String(vin) : String("N/A");
  if (key == "UPTIME") return String((unsigned long)millis());
  if (key == "NET_OP") return netop.length() ? netop : String("N/A");
  // Use the IP cached at connection time (telelogger global `ip`), NOT a live
  // cell.getIP() — that AT call blocks for up to ~15-45s when the modem is down
  // and would wedge the shared config UART (observed as "no response").
  if (key == "NET_IP") return ip.length() ? ip : String("N/A");
  if (gd && gd->ts) {
    if (key == "LAT") return String(gd->lat, 6);
    if (key == "LNG") return String(gd->lng, 6);
    if (key == "ALT") return String(gd->alt, 1);
    if (key == "SAT") return String((int)gd->sat);
    if (key == "SPD") return String(gd->speed * 1.852f, 1); // knots -> km/h
    if (key == "CRS") return String((int)gd->heading);
  }
  return "N/A";
}
LIVEHOOK
fi

# ---------------------------------------------------------------------------
# Config wiring: make the stored cfg actually drive device behavior.
#
# The stock telelogger reads config ONLY from config.h #defines + the legacy
# "storage" NVS namespace (CELL_APN/WIFI_SSID/WIFI_PWD). The cfg store we added
# (NVS namespace "cfg", written by the serial CFG= protocol) was completely
# inert — nothing read it back. These patches:
#   1. Declare runtime-override globals (before the macro-usage sites).
#   2. Rewrite the runtime-tunable compile-time macros to those globals.
#   3. Route the cellular credentials (sim_pin/apn_user/apn_pass) through cfg.
#   4. cfg.load() + fcmApplyConfig(cfg) at boot (after loadConfig()).
#   5. Append fcmApplyConfig() which pushes cfg into the live globals.
# Compile-time-only fields (srv_proto, storage, obd/mems/ble/httpd, psram,
# gnss mode) are NOT runtime-changeable and are left as #defines — the GUI
# marks them read-only to match.
echo "==> [3b/4] Wiring stored config into runtime behavior"
if ! grep -q 'fcmMotionThr' "${INO}"; then
  # 1. Runtime-override globals. Inserted right AFTER `#include "config.h"` (not
  #    after `Config cfg;`, which is emitted before config.h) so the #defines
  #    they seed from are already in scope. They precede every macro-usage site
  #    rewritten below; each is seeded from its compile-time #define, then
  #    overridden from cfg at boot. `done` guards a single insertion.
  awk '!done && /#include "config.h"/{
    print
    print "// FCM runtime config overrides (seeded from config.h, set from cfg at boot)."
    print "float fcmMotionThr = MOTION_THRESHOLD;"
    print "int   fcmMaxObdErr = MAX_OBD_ERRORS;"
    print "int   fcmGnssResetT = GNSS_RESET_TIMEOUT;"
    print "int   fcmPingbackInt = PING_BACK_INTERVAL;"
    print "int   fcmCoolingT = COOLING_DOWN_TEMP;"
    print "float fcmJumpstartV = JUMPSTART_VOLTAGE;"
    print "void fcmApplyConfig(Config&);"
    done=1
    next
  } {print}' "${INO}" > "${INO}.tmp" && mv "${INO}.tmp" "${INO}"

  # 2. Rewrite the runtime-tunable macro usages to the override globals.
  #    (Idempotent: after replacement the LHS macro pattern is gone.)
  sed -i 's/MOTION_THRESHOLD \* MOTION_THRESHOLD/fcmMotionThr * fcmMotionThr/g' "${INO}"
  sed -i 's/obd\.errors >= MAX_OBD_ERRORS/obd.errors >= fcmMaxObdErr/g' "${INO}"
  sed -i 's/lastGPStick > GNSS_RESET_TIMEOUT \* 1000/lastGPStick > fcmGnssResetT * 1000/g' "${INO}"
  sed -i 's/1000L \* PING_BACK_INTERVAL/1000L * fcmPingbackInt/g' "${INO}"
  sed -i 's/deviceTemp >= COOLING_DOWN_TEMP/deviceTemp >= fcmCoolingT/g' "${INO}"
  sed -i 's/obd\.getVoltage() < JUMPSTART_VOLTAGE/obd.getVoltage() < fcmJumpstartV/g' "${INO}"
fi

# 3. Route cellular credentials through cfg (empty cfg field -> NULL = use
#    modem/compile-time default, so an unset field never breaks attach).
if ! grep -q 'cfg.sim_pin.c_str()' "${INO}"; then
  sed -i 's/teleClient\.cell\.checkSIM(SIM_CARD_PIN)/teleClient.cell.checkSIM(cfg.sim_pin.length() ? cfg.sim_pin.c_str() : (const char*)0)/' "${INO}"
fi
if ! grep -q 'cfg.apn_user.c_str()' "${INO}"; then
  sed -i 's/teleClient\.cell\.setup(apn, APN_USERNAME, APN_PASSWORD)/teleClient.cell.setup(apn, cfg.apn_user.length() ? cfg.apn_user.c_str() : (const char*)0, cfg.apn_pass.length() ? cfg.apn_pass.c_str() : (const char*)0)/' "${INO}"
fi

# 4. Load cfg + apply at boot, right after the legacy loadConfig() in setup().
#    The `f` flag ensures we match the setup() loadConfig() (which follows the
#    "storage" nvs_open), not the ones in the BLE command handlers above it.
if ! grep -q 'fcmApplyConfig(cfg)' "${INO}"; then
  awk '/nvs_open\("storage"/{f=1}
       f && /loadConfig\(\);/{print; print "    cfg.load(); fcmApplyConfig(cfg);"; f=0; next}
       {print}' "${INO}" > "${INO}.tmp" && mv "${INO}.tmp" "${INO}"
fi

# 5. Append fcmApplyConfig(): pushes cfg into the live globals/overrides. Placed
#    at end of file so apn/wifiSSID/wifiPassword, syncInterval and the override
#    globals are all in scope. Credentials overwrite only when non-empty so an
#    unset field keeps the compile-time/legacy default; numerics treat >0 as set.
# Guard on the definition signature ("Config& c"), not the bare forward
# declaration ("Config&") inserted above, or the body would never be appended.
if ! grep -q 'void fcmApplyConfig(Config& c)' "${INO}"; then
  cat >> "${INO}" <<'APPLYHOOK'

// --- Freematics Config Manager: apply stored config to runtime (build.sh) ---
void fcmApplyConfig(Config& c) {
  if (c.apn.length())  { strncpy(apn, c.apn.c_str(), sizeof(apn) - 1); apn[sizeof(apn) - 1] = 0; }
  if (c.ssid.length()) { strncpy(wifiSSID, c.ssid.c_str(), sizeof(wifiSSID) - 1); wifiSSID[sizeof(wifiSSID) - 1] = 0; }
  if (c.wpwd.length()) { strncpy(wifiPassword, c.wpwd.c_str(), sizeof(wifiPassword) - 1); wifiPassword[sizeof(wifiPassword) - 1] = 0; }
  if (c.motion_thr > 0)   fcmMotionThr   = c.motion_thr;
  if (c.max_obd_err > 0)  fcmMaxObdErr   = c.max_obd_err;
  if (c.gnss_reset_t > 0) fcmGnssResetT  = c.gnss_reset_t;
  if (c.pingback_int > 0) fcmPingbackInt = c.pingback_int;
  if (c.cooling_t > 0)    fcmCoolingT    = c.cooling_t;
  if (c.jumpstart_v > 0)  fcmJumpstartV  = c.jumpstart_v / 1000.0f; // mV -> V
  if (c.srv_sync_int > 0) syncInterval   = (int32_t)c.srv_sync_int * 1000;
}
APPLYHOOK
fi

echo "==> [4/4] Building"
cd "${TELELOGGER_DIR}"

echo "    -- host-side native tests (g++ direct compile) --"
g++ -std=c++17 -I "${FW_DIR}/test" -I "${OVERLAY_DIR}" \
    "${FW_DIR}/test/configstore_test.cpp" -o /tmp/cs && /tmp/cs
g++ -std=c++17 -I "${FW_DIR}/test" -I "${OVERLAY_DIR}" \
    "${FW_DIR}/test/serial_handler_test.cpp" -o /tmp/sh && /tmp/sh

echo "    -- ESP32 firmware build --"
pio run -e esp32dev

echo "==> DONE. Firmware .bin in ${TELELOGGER_DIR}/.pio/build/esp32dev/firmware.bin"
