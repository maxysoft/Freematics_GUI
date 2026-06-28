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
echo "    patched telelogger.ino:"
grep -n 'serial_handler.h\|Config cfg\|processSerial' "${INO}" || true

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
