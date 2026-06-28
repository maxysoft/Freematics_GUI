#include "serial_handler.h"

#ifdef ARDUINO
#include <Arduino.h>
#else
#include "mock_serial.h"
#endif

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

    // Live data queries (delegate to firmware if available, else N/A) -------
    static const char* live[] = {
        "BATT", "RSSI", "VIN", "LAT", "LNG", "ALT",
        "SAT", "SPD", "CRS", "UPTIME", "NET_OP", "NET_IP"
    };
    for (const char* name : live) {
        if (up == name) {
#ifdef ARDUINO
            // Delegated to existing telelogger functions if linked; else N/A.
            // (Hook points added via telelogger_patch.cpp if available.)
            Serial.print("N/A\r\n");
#else
            Serial.print("N/A\r\n");
#endif
            return;
        }
    }

    Serial.print("ERROR\r\n");
}
