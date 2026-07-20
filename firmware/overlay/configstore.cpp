#include "configstore.h"

#ifdef ARDUINO
#include <nvs.h>
#else
#include "mock_nvs.h"
#endif

#include <cstdio>

static const char* NS = "cfg";

// String helpers -------------------------------------------------------------
static String getStr(const char* key, const String& def) {
#ifdef ARDUINO
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return def;
    size_t len = 0;
    String out = def;
    if (nvs_get_str(h, key, nullptr, &len) == ESP_OK) {
        char* buf = new char[len];
        if (nvs_get_str(h, key, buf, &len) == ESP_OK) out = String(buf);
        delete[] buf;
    }
    nvs_close(h);
    return out;
#else
    return mock_nvs_get_str(NS, key, def.c_str());
#endif
}

static void setStr(const char* key, const String& val) {
#ifdef ARDUINO
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return;
    nvs_set_str(h, key, val.c_str());
    nvs_close(h);
#else
    mock_nvs_set_str(NS, key, val.c_str());
#endif
}

static bool getBool(const char* key, bool def) {
#ifdef ARDUINO
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return def;
    uint8_t v = def ? 1 : 0;
    nvs_get_u8(h, key, &v);
    nvs_close(h);
    return v != 0;
#else
    return mock_nvs_get_u8(NS, key, def ? 1 : 0) != 0;
#endif
}

static void setBool(const char* key, bool val) {
#ifdef ARDUINO
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return;
    nvs_set_u8(h, key, val ? 1 : 0);
    nvs_close(h);
#else
    mock_nvs_set_u8(NS, key, val ? 1 : 0);
#endif
}

static int16_t getI16(const char* key, int16_t def) {
#ifdef ARDUINO
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return def;
    int16_t v = def;
    nvs_get_i16(h, key, &v);
    nvs_close(h);
    return v;
#else
    return mock_nvs_get_i16(NS, key, def);
#endif
}

static void setI16(const char* key, int16_t val) {
#ifdef ARDUINO
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return;
    nvs_set_i16(h, key, val);
    nvs_close(h);
#else
    mock_nvs_set_i16(NS, key, val);
#endif
}

static uint16_t getU16(const char* key, uint16_t def) {
#ifdef ARDUINO
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return def;
    uint16_t v = def;
    nvs_get_u16(h, key, &v);
    nvs_close(h);
    return v;
#else
    return (uint16_t)mock_nvs_get_i16(NS, key, (int16_t)def);
#endif
}

static void setU16(const char* key, uint16_t val) {
#ifdef ARDUINO
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return;
    nvs_set_u16(h, key, val);
    nvs_close(h);
#else
    mock_nvs_set_i16(NS, key, (int16_t)val);
#endif
}

static float getFloat(const char* key, float def) {
    // Stored as string to preserve precision.
    char buf[16];
    snprintf(buf, sizeof(buf), "%.4f", def);
    String s = getStr(key, String(buf));
    return strtof(s.c_str(), nullptr);
}

static void setFloat(const char* key, float val) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%.4f", val);
    setStr(key, String(buf));
}

// Defaults -------------------------------------------------------------------
void Config::defaults() {
    apn = "";
    ssid = "";
    wpwd = "";
    srv_host = "hub.freematics.com";
    // 0 / empty = "use the firmware's protocol default" (8081 for UDP, 443 for
    // HTTPS, compile-time SERVER_PATH). Hardcoding UDP-flavored values here
    // (8081, "/push") made switching to HTTPS silently target the wrong
    // port/path because non-zero stored values always win.
    srv_port = 0;
    srv_proto = "udp";
    srv_path = "";
    gnss = "standalone";
    storage = "none";
    obd = true;
    mems = true;
    wifi = false;
    ble = false;
    httpd = false;
    sim_pin = "";
    apn_user = "";
    apn_pass = "";
    ap_ssid = "Freematics";
    ap_pwd = "";
    motion_thr = 0.4f;
    jumpstart_v = 14500;
    cooling_t = 80;
    gnss_always = false;
    gnss_reset_t = 0;
    max_obd_err = 5;
    srv_sync_int = 30;
    pingback_int = 0;
    psram = false;
}

// Load -----------------------------------------------------------------------
void Config::load() {
    defaults();
    apn = getStr("apn", apn);
    ssid = getStr("ssid", ssid);
    wpwd = getStr("wpwd", wpwd);
    srv_host = getStr("srv_host", srv_host);
    srv_port = getU16("srv_port", srv_port);
    srv_proto = getStr("srv_proto", srv_proto);
    srv_path = getStr("srv_path", srv_path);
    gnss = getStr("gnss", gnss);
    storage = getStr("storage", storage);
    obd = getBool("obd", obd);
    mems = getBool("mems", mems);
    wifi = getBool("wifi", wifi);
    ble = getBool("ble", ble);
    httpd = getBool("httpd", httpd);
    sim_pin = getStr("sim_pin", sim_pin);
    apn_user = getStr("apn_user", apn_user);
    apn_pass = getStr("apn_pass", apn_pass);
    ap_ssid = getStr("ap_ssid", ap_ssid);
    ap_pwd = getStr("ap_pwd", ap_pwd);
    motion_thr = getFloat("motion_thr", motion_thr);
    jumpstart_v = getI16("jumpstart_v", jumpstart_v);
    cooling_t = getI16("cooling_t", cooling_t);
    gnss_always = getBool("gnss_always", gnss_always);
    gnss_reset_t = getI16("gnss_reset_t", gnss_reset_t);
    max_obd_err = getI16("max_obd_err", max_obd_err);
    srv_sync_int = getI16("srv_sync_int", srv_sync_int);
    pingback_int = getI16("pingback_int", pingback_int);
    psram = getBool("psram", psram);
}

// Save -----------------------------------------------------------------------
void Config::save() {
    setStr("apn", apn);
    setStr("ssid", ssid);
    setStr("wpwd", wpwd);
    setStr("srv_host", srv_host);
    setU16("srv_port", srv_port);
    setStr("srv_proto", srv_proto);
    setStr("srv_path", srv_path);
    setStr("gnss", gnss);
    setStr("storage", storage);
    setBool("obd", obd);
    setBool("mems", mems);
    setBool("wifi", wifi);
    setBool("ble", ble);
    setBool("httpd", httpd);
    setStr("sim_pin", sim_pin);
    setStr("apn_user", apn_user);
    setStr("apn_pass", apn_pass);
    setStr("ap_ssid", ap_ssid);
    setStr("ap_pwd", ap_pwd);
    setFloat("motion_thr", motion_thr);
    setI16("jumpstart_v", jumpstart_v);
    setI16("cooling_t", cooling_t);
    setBool("gnss_always", gnss_always);
    setI16("gnss_reset_t", gnss_reset_t);
    setI16("max_obd_err", max_obd_err);
    setI16("srv_sync_int", srv_sync_int);
    setI16("pingback_int", pingback_int);
    setBool("psram", psram);
#ifdef ARDUINO
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) == ESP_OK) {
        nvs_commit(h);
        nvs_close(h);
    }
#else
    mock_nvs_commit(NS);
#endif
}

// Dump -----------------------------------------------------------------------
String Config::dump() const {
    String s;
    s += "apn="; s += apn; s += "\n";
    s += "ssid="; s += ssid; s += "\n";
    s += "wpwd="; s += wpwd; s += "\n";
    s += "srv_host="; s += srv_host; s += "\n";
    s += "srv_port="; s += String(srv_port); s += "\n";
    s += "srv_proto="; s += srv_proto; s += "\n";
    s += "srv_path="; s += srv_path; s += "\n";
    s += "gnss="; s += gnss; s += "\n";
    s += "storage="; s += storage; s += "\n";
    s += "obd="; s += (obd ? "1" : "0"); s += "\n";
    s += "mems="; s += (mems ? "1" : "0"); s += "\n";
    s += "wifi="; s += (wifi ? "1" : "0"); s += "\n";
    s += "ble="; s += (ble ? "1" : "0"); s += "\n";
    s += "httpd="; s += (httpd ? "1" : "0"); s += "\n";
    s += "sim_pin="; s += sim_pin; s += "\n";
    s += "apn_user="; s += apn_user; s += "\n";
    s += "apn_pass="; s += apn_pass; s += "\n";
    s += "ap_ssid="; s += ap_ssid; s += "\n";
    s += "ap_pwd="; s += ap_pwd; s += "\n";
    s += "motion_thr="; s += String(motion_thr, 4); s += "\n";
    s += "jumpstart_v="; s += String(jumpstart_v); s += "\n";
    s += "cooling_t="; s += String(cooling_t); s += "\n";
    s += "gnss_always="; s += (gnss_always ? "1" : "0"); s += "\n";
    s += "gnss_reset_t="; s += String(gnss_reset_t); s += "\n";
    s += "max_obd_err="; s += String(max_obd_err); s += "\n";
    s += "srv_sync_int="; s += String(srv_sync_int); s += "\n";
    s += "pingback_int="; s += String(pingback_int); s += "\n";
    s += "psram="; s += (psram ? "1" : "0"); s += "\n";
    return s;
}

// Set / Get ------------------------------------------------------------------
static bool parseBool(const String& v) {
    String t = v;
    t.toLowerCase();
    return t == "1" || t == "true" || t == "yes" || t == "on";
}

// Fields are stored as int16_t; a blind (int16_t)toInt() cast silently wraps
// values > 32767 negative (e.g. 40000 -> -25536). Reject out-of-range input
// with ERR instead so the writer finds out immediately.
static bool parseI16(const String& v, int16_t& out) {
    long n = v.toInt();
    if (n < -32768 || n > 32767) return false;
    out = (int16_t)n;
    return true;
}

static bool parseU16(const String& v, uint16_t& out) {
    long n = v.toInt();
    if (n < 0 || n > 65535) return false;
    out = (uint16_t)n;
    return true;
}

// Enum-like keys accept only the tokens the firmware actually understands;
// anything else previously got an OK, persisted, and silently fell back at
// boot — the config claimed one mode while the device ran another.
static bool validEnum(const String& v, const char* a, const char* b, const char* c) {
    return v == a || v == b || v == c;
}

bool Config::set(const String& key, const String& val) {
    if (key == "apn") apn = val;
    else if (key == "ssid") ssid = val;
    else if (key == "wpwd") wpwd = val;
    else if (key == "srv_host") srv_host = val;
    else if (key == "srv_port") { if (!parseU16(val, srv_port)) return false; }
    else if (key == "srv_proto") { if (!validEnum(val, "udp", "https_get", "https_post")) return false; srv_proto = val; }
    else if (key == "srv_path") srv_path = val;
    else if (key == "gnss") { if (!validEnum(val, "none", "standalone", "cellular")) return false; gnss = val; }
    else if (key == "storage") { if (!validEnum(val, "none", "spiffs", "sd")) return false; storage = val; }
    else if (key == "obd") obd = parseBool(val);
    else if (key == "mems") mems = parseBool(val);
    else if (key == "wifi") wifi = parseBool(val);
    else if (key == "ble") ble = parseBool(val);
    else if (key == "httpd") httpd = parseBool(val);
    else if (key == "sim_pin") sim_pin = val;
    else if (key == "apn_user") apn_user = val;
    else if (key == "apn_pass") apn_pass = val;
    else if (key == "ap_ssid") ap_ssid = val;
    else if (key == "ap_pwd") ap_pwd = val;
    else if (key == "motion_thr") motion_thr = val.toFloat();
    else if (key == "jumpstart_v") { if (!parseI16(val, jumpstart_v)) return false; }
    else if (key == "cooling_t") { if (!parseI16(val, cooling_t)) return false; }
    else if (key == "gnss_always") gnss_always = parseBool(val);
    else if (key == "gnss_reset_t") { if (!parseI16(val, gnss_reset_t)) return false; }
    else if (key == "max_obd_err") { if (!parseI16(val, max_obd_err)) return false; }
    else if (key == "srv_sync_int") { if (!parseI16(val, srv_sync_int)) return false; }
    else if (key == "pingback_int") { if (!parseI16(val, pingback_int)) return false; }
    else if (key == "psram") psram = parseBool(val);
    else return false;
    return true;
}

String Config::get(const String& key) const {
    if (key == "apn") return apn;
    if (key == "ssid") return ssid;
    if (key == "wpwd") return wpwd;
    if (key == "srv_host") return srv_host;
    if (key == "srv_port") return String(srv_port);
    if (key == "srv_proto") return srv_proto;
    if (key == "srv_path") return srv_path;
    if (key == "gnss") return gnss;
    if (key == "storage") return storage;
    if (key == "obd") return obd ? "1" : "0";
    if (key == "mems") return mems ? "1" : "0";
    if (key == "wifi") return wifi ? "1" : "0";
    if (key == "ble") return ble ? "1" : "0";
    if (key == "httpd") return httpd ? "1" : "0";
    if (key == "sim_pin") return sim_pin;
    if (key == "apn_user") return apn_user;
    if (key == "apn_pass") return apn_pass;
    if (key == "ap_ssid") return ap_ssid;
    if (key == "ap_pwd") return ap_pwd;
    if (key == "motion_thr") return String(motion_thr, 4);
    if (key == "jumpstart_v") return String(jumpstart_v);
    if (key == "cooling_t") return String(cooling_t);
    if (key == "gnss_always") return gnss_always ? "1" : "0";
    if (key == "gnss_reset_t") return String(gnss_reset_t);
    if (key == "max_obd_err") return String(max_obd_err);
    if (key == "srv_sync_int") return String(srv_sync_int);
    if (key == "pingback_int") return String(pingback_int);
    if (key == "psram") return psram ? "1" : "0";
    return "";
}
