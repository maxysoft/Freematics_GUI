#include "serial_handler.h"

#ifdef ARDUINO
#include <Arduino.h>
#else
#include "mock_serial.h"
#endif

// Live-telemetry hook. The REAL implementation lives in the vendored
// telelogger.ino where the live globals (batteryVoltage, rssi, netop, gd, vin,
// teleClient, millis()) are in scope. This weak default is linked when that
// override is absent (host tests, un-patched builds) so the firmware always
// builds and simply reports "N/A" for every field.
__attribute__((weak)) String fcmLiveQuery(const String&) {
    return "N/A";
}

// Pre-restart hook: the sketch's strong override closes the active log file so
// an app-triggered REBOOT can't lose/corrupt the open SD/SPIFFS log (the BLE
// RESET path has always done this). Weak default for host tests.
__attribute__((weak)) void fcmPrepareRestart() {}

// Config-window machinery (see serial_handler.h / loop() guard in build.sh).
// A config command opens an N-ms window during which loop() skips telemetry so
// the shared UART is quiet and replies are prompt. Live queries do NOT touch it.
#ifndef FCM_CONFIG_WINDOW_MS
#define FCM_CONFIG_WINDOW_MS 8000UL
#endif

volatile unsigned long fcmConfigUntil = 0;

static inline void fcmTouchConfig() {
#ifdef ARDUINO
    fcmConfigUntil = millis() + FCM_CONFIG_WINDOW_MS;
#endif
}

bool fcmInConfig() {
#ifdef ARDUINO
    // Signed difference is wraparound-safe across millis() overflow.
    return (long)(fcmConfigUntil - millis()) > 0;
#else
    return false;
#endif
}

// Keep-awake window: ANY serial command (config OR live query) means a host is
// connected, so the loop() guard must NOT let the device enter standby()
// (which blocks in waitMotion(-1) / a voltage wait until the device is moved,
// killing serial). Refreshed on every received command; the desktop app also
// pings periodically so the device stays responsive for the whole session.
#ifndef FCM_AWAKE_WINDOW_MS
#define FCM_AWAKE_WINDOW_MS 60000UL
#endif

volatile unsigned long fcmAwakeUntil = 0;

bool fcmAwake() {
#ifdef ARDUINO
    return (long)(fcmAwakeUntil - millis()) > 0;
#else
    return false;
#endif
}

// Dispatch a single received command line (terminated by \r or \n upstream).
// All responses terminated with \r\n.
static void handleCommandLine(Config& cfg, String line) {
    line.trim();
    if (line.endsWith("\r")) line.remove(line.length() - 1);
    line.trim();
    if (line.length() == 0) return;

#ifdef ARDUINO
    // A command arrived -> a host is connected -> keep the device awake.
    fcmAwakeUntil = millis() + FCM_AWAKE_WINDOW_MS;
#endif

    String up = line;
    up.toUpperCase();

    // CFG_DUMP / CFG_SAVE / CFG_LOAD ----------------------------------------
    if (up == "CFG_DUMP") {
        fcmTouchConfig();
        Serial.print(cfg.dump());
        Serial.print("OK\r\n");
        return;
    }
    if (up == "CFG_SAVE") {
        fcmTouchConfig();
        cfg.save();
        Serial.print("OK\r\n");
        return;
    }
    if (up == "CFG_LOAD") {
        fcmTouchConfig();
        cfg.load();
        Serial.print("OK\r\n");
        return;
    }

    // REBOOT — restart the device so freshly saved config takes effect. The
    // app uses this for "Apply & Restart" instead of asking for a power-cycle.
    if (up == "REBOOT") {
        Serial.print("OK\r\n");
#ifdef ARDUINO
        Serial.flush();
        fcmPrepareRestart();
        delay(100);
        ESP.restart();
#endif
        return;
    }

    // CFG=key=val -----------------------------------------------------------
    if (up.startsWith("CFG=")) {
        fcmTouchConfig();
        String kv = line.substring(4);
        int eq = kv.indexOf('=');
        if (eq < 0) {
            Serial.print("ERR\r\n");
            return;
        }
        String key = kv.substring(0, eq);
        String val = kv.substring(eq + 1);
        key.trim();
        if (cfg.set(key, val)) {
            Serial.print("OK\r\n");
        } else {
            Serial.print("ERR\r\n");
        }
        return;
    }

    // Legacy per-field query/set: APN? APN= SSID? SSID= WPWD? WPWD= --------
    static const char* legacy[] = {"APN", "SSID", "WPWD"};
    for (const char* name : legacy) {
        String n = name;
        String nUp = n;
        nUp.toUpperCase();
        String q = nUp + "?";
        String s = nUp + "=";
        if (up == q) {
            fcmTouchConfig();
            String key = n;
            key.toLowerCase();
            Serial.print(cfg.get(key));
            Serial.print("\r\n");
            return;
        }
        if (up.startsWith(s)) {
            fcmTouchConfig();
            String val = line.substring(s.length());
            String key = n;
            key.toLowerCase();
            cfg.set(key, val);
            Serial.print("OK\r\n");
            return;
        }
    }

    // Live data queries — delegate to fcmLiveQuery() (real values on-device,
    // "N/A" via the weak default for host tests / un-patched builds). -------
    static const char* live[] = {
        "BATT", "RSSI", "VIN", "LAT", "LNG", "ALT",
        "SAT", "SPD", "CRS", "UPTIME", "NET_OP", "NET_IP"
    };
    for (const char* name : live) {
        if (up == name) {
            Serial.print(fcmLiveQuery(up));
            Serial.print("\r\n");
            return;
        }
    }

    Serial.print("ERROR\r\n");
}

// Drain ALL queued command lines each call so a backlog (e.g. from rapid live
// polling that the busy telemetry loop serviced one-per-iteration) can't delay
// a config command. While a config command holds the window open, the loop()
// guard suppresses telemetry, keeping this responsive and the UART quiet.
void processSerial(Config& cfg) {
    while (Serial.available()) {
        handleCommandLine(cfg, Serial.readStringUntil('\n'));
    }
}
