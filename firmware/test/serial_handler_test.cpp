#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

#include "Arduino.h"
#include "mock_nvs.h"
#include "mock_serial.h"

MockSerial Serial;

#include "../overlay/configstore.h"
#include "../overlay/configstore.cpp"
#include "../overlay/serial_handler.cpp"

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { printf("FAIL: %s\n", msg); failures++; } \
    else { printf("ok: %s\n", msg); } \
} while (0)

static void feed(const std::string& s) {
    Serial.reset();
    Serial.feed(s);
}

int main() {
    mock_nvs_reset();
    Config cfg;
    cfg.load();

    // 1. CFG_DUMP -> output contains all keys + OK.
    feed("CFG_DUMP\r\n");
    processSerial(cfg);
    {
        std::string out(Serial.out);
        CHECK(out.find("apn=") != std::string::npos, "CFG_DUMP has apn");
        CHECK(out.find("srv_host=") != std::string::npos, "CFG_DUMP has srv_host");
        CHECK(out.find("psram=") != std::string::npos, "CFG_DUMP has psram");
        CHECK(out.find("OK\r\n") != std::string::npos, "CFG_DUMP ends OK");
    }

    // 2. CFG=apn=test -> cfg.apn == "test".
    feed("CFG=apn=test\r\n");
    processSerial(cfg);
    CHECK(Serial.out == "OK\r\n", "CFG=apn=test returns OK");
    CHECK(cfg.apn == "test", "cfg.apn updated to test");

    // 3. CFG=ssid=MyWifi -> updated.
    feed("CFG=ssid=MyWifi\r\n");
    processSerial(cfg);
    CHECK(cfg.ssid == "MyWifi", "cfg.ssid updated");

    // 4. CFG= with unknown key -> ERR.
    feed("CFG=bogus=1\r\n");
    processSerial(cfg);
    CHECK(Serial.out == "ERR\r\n", "CFG=unknown returns ERR");

    // 5. CFG= with no '=' -> ERR.
    feed("CFG=apn\r\n");
    processSerial(cfg);
    CHECK(Serial.out == "ERR\r\n", "CFG= no equals returns ERR");

    // 6. CFG_SAVE -> OK.
    feed("CFG_SAVE\r\n");
    processSerial(cfg);
    CHECK(Serial.out == "OK\r\n", "CFG_SAVE returns OK");
    // Verify persisted.
    Config c2;
    c2.load();
    CHECK(c2.apn == "test", "CFG_SAVE persisted apn");

    // 7. CFG_LOAD -> OK and reloads.
    feed("CFG_LOAD\r\n");
    processSerial(cfg);
    CHECK(Serial.out == "OK\r\n", "CFG_LOAD returns OK");

    // 8. APN? -> returns current apn.
    feed("APN?\r\n");
    processSerial(cfg);
    CHECK(Serial.out == "test\r\n", "APN? returns current apn");

    // 9. APN=newvalue -> OK and updates.
    feed("APN=newvalue\r\n");
    processSerial(cfg);
    CHECK(Serial.out == "OK\r\n", "APN= returns OK");
    CHECK(cfg.apn == "newvalue", "APN= updates cfg.apn");

    // 10. SSID? / SSID= / WPWD? / WPWD=.
    feed("SSID?\r\n");
    processSerial(cfg);
    CHECK(Serial.out == "MyWifi\r\n", "SSID? returns current ssid");
    feed("SSID=OtherNet\r\n");
    processSerial(cfg);
    CHECK(cfg.ssid == "OtherNet", "SSID= updates cfg.ssid");
    feed("WPWD=\r\n");
    processSerial(cfg);
    CHECK(Serial.out == "OK\r\n", "WPWD= empty returns OK");
    feed("WPWD?\r\n");
    processSerial(cfg);
    CHECK(Serial.out == "\r\n", "WPWD? empty returns empty line");

    // 11. Live data query -> N/A.
    feed("BATT\r\n");
    processSerial(cfg);
    CHECK(Serial.out == "N/A\r\n", "BATT returns N/A");
    feed("VIN\r\n");
    processSerial(cfg);
    CHECK(Serial.out == "N/A\r\n", "VIN returns N/A");

    // 12. Unknown command -> ERROR.
    feed("UNKNOWN\r\n");
    processSerial(cfg);
    CHECK(Serial.out == "ERROR\r\n", "unknown returns ERROR");

    // 13. Empty line -> no response.
    feed("\r\n");
    Serial.reset();
    processSerial(cfg);
    CHECK(Serial.out.empty(), "empty line no response");

    // 14. Backlog drain: several queued lines are ALL processed in one call so a
    // config command can't get stuck behind stale live-poll queries.
    feed("BATT\r\nRSSI\r\nCFG=apn=internet.it\r\n");
    processSerial(cfg);
    CHECK(Serial.out == "N/A\r\nN/A\r\nOK\r\n", "drains backlog and reaches CFG= in one call");
    CHECK(cfg.apn == "internet.it", "CFG= behind backlog still applied");

    // 15. REBOOT acks with OK (host build: no actual restart, ESP.restart()
    // is ARDUINO-gated).
    feed("REBOOT\r\n");
    processSerial(cfg);
    CHECK(Serial.out == "OK\r\n", "REBOOT returns OK");

    if (failures == 0) {
        printf("\nALL SERIAL_HANDLER TESTS PASSED\n");
        return 0;
    }
    printf("\n%d SERIAL_HANDLER TESTS FAILED\n", failures);
    return 1;
}
