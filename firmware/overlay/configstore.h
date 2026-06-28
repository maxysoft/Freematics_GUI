#ifndef CONFIGSTORE_H
#define CONFIGSTORE_H

#include <Arduino.h>

// Mirrors src-tauri/src/protocol/types.rs DeviceConfig (28 fields).
// NVS namespace "cfg". Keys documented in configstore.cpp.
struct Config {
    String apn;            // cell_apn
    String ssid;           // wifi_ssid
    String wpwd;           // wifi_password
    String srv_host;       // server_host
    uint16_t srv_port;     // server_port
    String srv_proto;      // udp | https_get | https_post
    String srv_path;       // server_path
    String gnss;           // none | standalone | cellular
    String storage;        // none | spiffs | sd
    bool obd;              // enable_obd
    bool mems;             // enable_mems
    bool wifi;             // enable_wifi
    bool ble;              // enable_ble
    bool httpd;            // enable_httpd
    String sim_pin;
    String apn_user;       // apn_username
    String apn_pass;       // apn_password
    String ap_ssid;        // wifi_ap_ssid
    String ap_pwd;         // wifi_ap_password
    float motion_thr;      // motion_threshold
    int16_t jumpstart_v;   // jumpstart_voltage
    int16_t cooling_t;     // cooling_down_temp
    bool gnss_always;      // gnss_always_on
    int16_t gnss_reset_t;  // gnss_reset_timeout
    int16_t max_obd_err;   // max_obd_errors
    int16_t srv_sync_int;  // server_sync_interval
    int16_t pingback_int;  // ping_back_interval
    bool psram;            // board_has_psram

    void defaults();
    void load();
    void save();
    String dump() const;
    bool set(const String& key, const String& val);
    String get(const String& key) const;
};

#endif
