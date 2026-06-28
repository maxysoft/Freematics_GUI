#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

// Include order matters: Arduino shim + mock NVS before configstore.
#include "Arduino.h"
#include "mock_nvs.h"
#include "mock_serial.h"

MockSerial Serial;

#include "../overlay/configstore.h"
#include "../overlay/configstore.cpp"

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { printf("FAIL: %s\n", msg); failures++; } \
    else { printf("ok: %s\n", msg); } \
} while (0)

static std::vector<std::string> split(const std::string& s, char d) {
    std::vector<std::string> out;
    size_t start = 0;
    while (true) {
        size_t p = s.find(d, start);
        if (p == std::string::npos) { out.push_back(s.substr(start)); break; }
        out.push_back(s.substr(start, p - start));
        start = p + 1;
    }
    return out;
}

int main() {
    mock_nvs_reset();

    // 1. load() returns defaults on empty NVS.
    Config c;
    c.load();
    CHECK(c.srv_host == "hub.freematics.com", "default srv_host");
    CHECK(c.srv_port == 8081, "default srv_port");
    CHECK(c.srv_proto == "udp", "default srv_proto");
    CHECK(c.srv_path == "/push", "default srv_path");
    CHECK(c.gnss == "standalone", "default gnss");
    CHECK(c.storage == "none", "default storage");
    CHECK(c.obd == true, "default obd");
    CHECK(c.mems == true, "default mems");
    CHECK(c.wifi == false, "default wifi");
    CHECK(c.ble == false, "default ble");
    CHECK(c.httpd == false, "default httpd");
    CHECK(c.ap_ssid == "Freematics", "default ap_ssid");
    CHECK(c.motion_thr > 0.39f && c.motion_thr < 0.41f, "default motion_thr");
    CHECK(c.jumpstart_v == 14500, "default jumpstart_v");
    CHECK(c.cooling_t == 80, "default cooling_t");
    CHECK(c.max_obd_err == 5, "default max_obd_err");
    CHECK(c.srv_sync_int == 30, "default srv_sync_int");
    CHECK(c.psram == false, "default psram");

    // 2. save() then load() round-trips.
    c.apn = "internet";
    c.ssid = "home";
    c.wpwd = "secret";
    c.srv_port = 9999;
    c.srv_proto = "https_post";
    c.obd = false;
    c.motion_thr = 1.5f;
    c.jumpstart_v = 12000;
    c.gnss_always = true;
    c.psram = true;
    c.save();

    Config c2;
    c2.load();
    CHECK(c2.apn == "internet", "roundtrip apn");
    CHECK(c2.ssid == "home", "roundtrip ssid");
    CHECK(c2.wpwd == "secret", "roundtrip wpwd");
    CHECK(c2.srv_port == 9999, "roundtrip srv_port");
    CHECK(c2.srv_proto == "https_post", "roundtrip srv_proto");
    CHECK(c2.obd == false, "roundtrip obd");
    CHECK(c2.motion_thr > 1.49f && c2.motion_thr < 1.51f, "roundtrip motion_thr");
    CHECK(c2.jumpstart_v == 12000, "roundtrip jumpstart_v");
    CHECK(c2.gnss_always == true, "roundtrip gnss_always");
    CHECK(c2.psram == true, "roundtrip psram");

    // 3. dump() produces all 28 keys.
    String dump = c2.dump();
    std::string ds(dump.c_str());
    auto lines = split(ds, '\n');
    int keycount = 0;
    static const char* expected_keys[] = {
        "apn","ssid","wpwd","srv_host","srv_port","srv_proto","srv_path",
        "gnss","storage","obd","mems","wifi","ble","httpd","sim_pin",
        "apn_user","apn_pass","ap_ssid","ap_pwd","motion_thr","jumpstart_v",
        "cooling_t","gnss_always","gnss_reset_t","max_obd_err","srv_sync_int",
        "pingback_int","psram"
    };
    for (const auto& line : lines) {
        if (line.empty()) continue;
        auto eq = line.find('=');
        if (eq == std::string::npos) continue;
        std::string k = line.substr(0, eq);
        for (const char* ek : expected_keys) {
            if (k == ek) { keycount++; break; }
        }
    }
    CHECK(keycount == 28, "dump has all 28 keys");

    // 4. dump() values match.
    CHECK(ds.find("apn=internet") != std::string::npos, "dump apn value");
    CHECK(ds.find("srv_port=9999") != std::string::npos, "dump srv_port value");
    CHECK(ds.find("psram=1") != std::string::npos, "dump psram value");

    // 5. set() / get() round-trip.
    CHECK(c2.set("apn", "newapn"), "set apn returns true");
    CHECK(c2.get("apn") == "newapn", "get apn after set");
    CHECK(!c2.set("nonexistent_key", "x"), "set unknown returns false");
    CHECK(c2.set("obd", "1"), "set obd");
    CHECK(c2.get("obd") == "1", "get obd after set");

    if (failures == 0) {
        printf("\nALL CONFIGSTORE TESTS PASSED\n");
        return 0;
    }
    printf("\n%d CONFIGSTORE TESTS FAILED\n", failures);
    return 1;
}
