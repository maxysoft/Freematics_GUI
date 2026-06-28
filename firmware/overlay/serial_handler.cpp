#include "serial_handler.h"

#ifdef ARDUINO
#include <Arduino.h>
#else
#include "mock_serial.h"
#endif

// Live-telemetry hook. The REAL implementation is appended to telelogger.ino at
// build time (see firmware/build.sh) where the live globals (batteryVoltage,
// rssi, netop, gd, vin, teleClient, millis()) are in scope. This weak default
// is linked when that override is absent (host tests, un-patched builds) so the
// firmware always builds and simply reports "N/A" for every field.
__attribute__((weak)) String fcmLiveQuery(const String&) {
    return "N/A";
}

// Reads one line from Serial (terminated by \r or \n), dispatches command.
// All responses terminated with \r\n.
void processSerial(Config& cfg) {
    if (!Serial.available()) return;

    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.endsWith("\r")) line.remove(line.length() - 1);
    line.trim();
    if (line.length() == 0) return;

    String up = line;
    up.toUpperCase();

    // CFG_DUMP / CFG_SAVE / CFG_LOAD ----------------------------------------
    if (up == "CFG_DUMP") {
        Serial.print(cfg.dump());
        Serial.print("OK\r\n");
        return;
    }
    if (up == "CFG_SAVE") {
        cfg.save();
        Serial.print("OK\r\n");
        return;
    }
    if (up == "CFG_LOAD") {
        cfg.load();
        Serial.print("OK\r\n");
        return;
    }

    // CFG=key=val -----------------------------------------------------------
    if (up.startsWith("CFG=")) {
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
            String key = n;
            key.toLowerCase();
            Serial.print(cfg.get(key));
            Serial.print("\r\n");
            return;
        }
        if (up.startsWith(s)) {
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
