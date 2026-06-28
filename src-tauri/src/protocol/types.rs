use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerProtocol {
    Udp,
    HttpsGet,
    HttpsPost,
}

impl Default for ServerProtocol {
    fn default() -> Self {
        ServerProtocol::Udp
    }
}

impl fmt::Display for ServerProtocol {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ServerProtocol::Udp => write!(f, "udp"),
            ServerProtocol::HttpsGet => write!(f, "https_get"),
            ServerProtocol::HttpsPost => write!(f, "https_post"),
        }
    }
}

impl ServerProtocol {
    pub fn from_str(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "https_get" | "httpsget" | "get" => ServerProtocol::HttpsGet,
            "https_post" | "httpspost" | "post" => ServerProtocol::HttpsPost,
            _ => ServerProtocol::Udp,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GnssMode {
    None,
    Standalone,
    Cellular,
}

impl Default for GnssMode {
    fn default() -> Self {
        GnssMode::Standalone
    }
}

impl fmt::Display for GnssMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GnssMode::None => write!(f, "none"),
            GnssMode::Standalone => write!(f, "standalone"),
            GnssMode::Cellular => write!(f, "cellular"),
        }
    }
}

impl GnssMode {
    pub fn from_str(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "none" | "off" | "0" => GnssMode::None,
            "cellular" | "cell" => GnssMode::Cellular,
            _ => GnssMode::Standalone,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageMode {
    None,
    Spiffs,
    Sd,
}

impl Default for StorageMode {
    fn default() -> Self {
        StorageMode::None
    }
}

impl fmt::Display for StorageMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StorageMode::None => write!(f, "none"),
            StorageMode::Spiffs => write!(f, "spiffs"),
            StorageMode::Sd => write!(f, "sd"),
        }
    }
}

impl StorageMode {
    pub fn from_str(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "spiffs" => StorageMode::Spiffs,
            "sd" | "sdcard" => StorageMode::Sd,
            _ => StorageMode::None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "snake_case")]
pub struct DeviceConfig {
    pub cell_apn: String,
    pub wifi_ssid: String,
    pub wifi_password: String,
    pub server_host: String,
    pub server_port: u16,
    pub server_protocol: ServerProtocol,
    pub server_path: String,
    pub gnss_mode: GnssMode,
    pub storage: StorageMode,
    pub enable_obd: bool,
    pub enable_mems: bool,
    pub enable_wifi: bool,
    pub enable_ble: bool,
    pub enable_httpd: bool,
    pub sim_pin: String,
    pub apn_username: String,
    pub apn_password: String,
    pub wifi_ap_ssid: String,
    pub wifi_ap_password: String,
    pub motion_threshold: f32,
    pub jumpstart_voltage: i32,
    pub cooling_down_temp: i32,
    pub gnss_always_on: bool,
    pub gnss_reset_timeout: i32,
    pub max_obd_errors: i32,
    pub server_sync_interval: i32,
    pub ping_back_interval: i32,
    pub board_has_psram: bool,
}

impl Default for DeviceConfig {
    fn default() -> Self {
        Self {
            cell_apn: String::new(),
            wifi_ssid: String::new(),
            wifi_password: String::new(),
            server_host: "hub.freematics.com".to_string(),
            server_port: 8081,
            server_protocol: ServerProtocol::Udp,
            server_path: "/push".to_string(),
            gnss_mode: GnssMode::Standalone,
            storage: StorageMode::None,
            enable_obd: true,
            enable_mems: true,
            enable_wifi: false,
            enable_ble: false,
            enable_httpd: false,
            sim_pin: String::new(),
            apn_username: String::new(),
            apn_password: String::new(),
            wifi_ap_ssid: "Freematics".to_string(),
            wifi_ap_password: String::new(),
            motion_threshold: 0.4,
            jumpstart_voltage: 14500,
            cooling_down_temp: 80,
            gnss_always_on: false,
            gnss_reset_timeout: 0,
            max_obd_errors: 5,
            server_sync_interval: 30,
            ping_back_interval: 0,
            board_has_psram: false,
        }
    }
}

fn parse_bool(s: &str) -> bool {
    matches!(
        s.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn parse_f32(s: &str) -> f32 {
    s.trim().parse().unwrap_or(0.0)
}

fn parse_i32(s: &str) -> i32 {
    s.trim().parse().unwrap_or(0)
}

fn parse_u16(s: &str) -> u16 {
    s.trim().parse().unwrap_or(0)
}

impl DeviceConfig {
    pub fn from_dump_lines(lines: &[String]) -> Result<Self, String> {
        let mut cfg = DeviceConfig::default();
        for line in lines {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Some((key, val)) = line.split_once('=') else {
                continue;
            };
            let key = key.trim();
            let val = val.trim();
            match key {
                "apn" | "cell_apn" => cfg.cell_apn = val.to_string(),
                "ssid" | "wifi_ssid" => cfg.wifi_ssid = val.to_string(),
                "wpwd" | "wifi_password" => cfg.wifi_password = val.to_string(),
                "srv_host" | "server_host" => cfg.server_host = val.to_string(),
                "srv_port" | "server_port" => cfg.server_port = parse_u16(val),
                "srv_proto" | "server_protocol" => {
                    cfg.server_protocol = ServerProtocol::from_str(val)
                }
                "srv_path" | "server_path" => cfg.server_path = val.to_string(),
                "gnss" | "gnss_mode" => cfg.gnss_mode = GnssMode::from_str(val),
                "storage" => cfg.storage = StorageMode::from_str(val),
                "obd" | "enable_obd" => cfg.enable_obd = parse_bool(val),
                "mems" | "enable_mems" => cfg.enable_mems = parse_bool(val),
                "wifi" | "enable_wifi" => cfg.enable_wifi = parse_bool(val),
                "ble" | "enable_ble" => cfg.enable_ble = parse_bool(val),
                "httpd" | "enable_httpd" => cfg.enable_httpd = parse_bool(val),
                "sim_pin" => cfg.sim_pin = val.to_string(),
                "apn_user" | "apn_username" => cfg.apn_username = val.to_string(),
                "apn_pass" | "apn_password" => cfg.apn_password = val.to_string(),
                "ap_ssid" | "wifi_ap_ssid" => cfg.wifi_ap_ssid = val.to_string(),
                "ap_pwd" | "wifi_ap_password" => cfg.wifi_ap_password = val.to_string(),
                "motion_thr" | "motion_threshold" => cfg.motion_threshold = parse_f32(val),
                "jumpstart_v" | "jumpstart_voltage" => cfg.jumpstart_voltage = parse_i32(val),
                "cooling_t" | "cooling_temp" | "cooling_down_temp" => {
                    cfg.cooling_down_temp = parse_i32(val)
                }
                "gnss_always" | "gnss_always_on" => cfg.gnss_always_on = parse_bool(val),
                "gnss_reset_t" | "gnss_reset_to" | "gnss_reset_timeout" => {
                    cfg.gnss_reset_timeout = parse_i32(val)
                }
                "max_obd_err" | "max_obd_errors" => cfg.max_obd_errors = parse_i32(val),
                "srv_sync_int" | "sync_interval" | "server_sync_interval" => {
                    cfg.server_sync_interval = parse_i32(val)
                }
                "pingback_int" | "ping_interval" | "ping_back_interval" => {
                    cfg.ping_back_interval = parse_i32(val)
                }
                "psram" | "board_has_psram" => cfg.board_has_psram = parse_bool(val),
                _ => {}
            }
        }
        Ok(cfg)
    }

    pub fn to_set_commands(&self) -> Vec<(String, String)> {
        vec![
            ("apn".to_string(), self.cell_apn.clone()),
            ("ssid".to_string(), self.wifi_ssid.clone()),
            ("wpwd".to_string(), self.wifi_password.clone()),
            ("srv_host".to_string(), self.server_host.clone()),
            ("srv_port".to_string(), self.server_port.to_string()),
            ("srv_proto".to_string(), self.server_protocol.to_string()),
            ("srv_path".to_string(), self.server_path.clone()),
            ("gnss".to_string(), self.gnss_mode.to_string()),
            ("storage".to_string(), self.storage.to_string()),
            ("obd".to_string(), bool_str(self.enable_obd)),
            ("mems".to_string(), bool_str(self.enable_mems)),
            ("wifi".to_string(), bool_str(self.enable_wifi)),
            ("ble".to_string(), bool_str(self.enable_ble)),
            ("httpd".to_string(), bool_str(self.enable_httpd)),
            ("sim_pin".to_string(), self.sim_pin.clone()),
            ("apn_user".to_string(), self.apn_username.clone()),
            ("apn_pass".to_string(), self.apn_password.clone()),
            ("ap_ssid".to_string(), self.wifi_ap_ssid.clone()),
            ("ap_pwd".to_string(), self.wifi_ap_password.clone()),
            ("motion_thr".to_string(), self.motion_threshold.to_string()),
            ("jumpstart_v".to_string(), self.jumpstart_voltage.to_string()),
            ("cooling_t".to_string(), self.cooling_down_temp.to_string()),
            ("gnss_always".to_string(), bool_str(self.gnss_always_on)),
            ("gnss_reset_t".to_string(), self.gnss_reset_timeout.to_string()),
            ("max_obd_err".to_string(), self.max_obd_errors.to_string()),
            (
                "srv_sync_int".to_string(),
                self.server_sync_interval.to_string(),
            ),
            (
                "pingback_int".to_string(),
                self.ping_back_interval.to_string(),
            ),
            ("psram".to_string(), bool_str(self.board_has_psram)),
        ]
    }
}

fn bool_str(b: bool) -> String {
    if b {
        "1".to_string()
    } else {
        "0".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_dump_lines_parses_known_keys() {
        let lines = vec![
            "apn=internet".to_string(),
            "ssid=home".to_string(),
            "wpwd=secret".to_string(),
            "srv_host=hub.freematics.com".to_string(),
            "srv_port=8081".to_string(),
            "srv_proto=udp".to_string(),
            "srv_path=/push".to_string(),
            "gnss=standalone".to_string(),
            "storage=none".to_string(),
            "obd=1".to_string(),
            "mems=1".to_string(),
            "wifi=0".to_string(),
            "ble=0".to_string(),
            "httpd=0".to_string(),
            "sim_pin=".to_string(),
            "apn_user=".to_string(),
            "apn_pass=".to_string(),
            "ap_ssid=Freematics".to_string(),
            "ap_pwd=".to_string(),
            "motion_thr=0.4".to_string(),
            "jumpstart_v=14500".to_string(),
            "cooling_temp=80".to_string(),
            "gnss_always_on=0".to_string(),
            "gnss_reset_to=0".to_string(),
            "max_obd_err=5".to_string(),
            "sync_interval=30".to_string(),
            "ping_interval=0".to_string(),
            "psram=0".to_string(),
        ];
        let cfg = DeviceConfig::from_dump_lines(&lines).unwrap();
        assert_eq!(cfg.cell_apn, "internet");
        assert_eq!(cfg.wifi_ssid, "home");
        assert_eq!(cfg.wifi_password, "secret");
        assert_eq!(cfg.server_host, "hub.freematics.com");
        assert_eq!(cfg.server_port, 8081);
        assert_eq!(cfg.server_protocol, ServerProtocol::Udp);
        assert_eq!(cfg.server_path, "/push");
        assert_eq!(cfg.gnss_mode, GnssMode::Standalone);
        assert_eq!(cfg.storage, StorageMode::None);
        assert!(cfg.enable_obd);
        assert!(cfg.enable_mems);
        assert!(!cfg.enable_wifi);
        assert!(!cfg.enable_ble);
        assert!(!cfg.enable_httpd);
        assert_eq!(cfg.wifi_ap_ssid, "Freematics");
        assert!((cfg.motion_threshold - 0.4).abs() < 1e-6);
        assert_eq!(cfg.jumpstart_voltage, 14500);
        assert_eq!(cfg.cooling_down_temp, 80);
        assert_eq!(cfg.max_obd_errors, 5);
        assert_eq!(cfg.server_sync_interval, 30);
    }

    #[test]
    fn to_set_commands_covers_all_fields() {
        let cfg = DeviceConfig::default();
        let cmds = cfg.to_set_commands();
        assert_eq!(cmds.len(), 28);
        let keys: Vec<&str> = cmds.iter().map(|(k, _)| k.as_str()).collect();
        for expected in [
            "apn",
            "ssid",
            "wpwd",
            "srv_host",
            "srv_port",
            "srv_proto",
            "srv_path",
            "gnss",
            "storage",
            "obd",
            "mems",
            "wifi",
            "ble",
            "httpd",
            "sim_pin",
            "apn_user",
            "apn_pass",
            "ap_ssid",
            "ap_pwd",
            "motion_thr",
            "jumpstart_v",
            "cooling_t",
            "gnss_always",
            "gnss_reset_t",
            "max_obd_err",
            "srv_sync_int",
            "pingback_int",
            "psram",
        ] {
            assert!(keys.contains(&expected), "missing key: {expected}");
        }
    }

    #[test]
    fn default_matches_research_defaults() {
        let cfg = DeviceConfig::default();
        assert_eq!(cfg.server_host, "hub.freematics.com");
        assert_eq!(cfg.server_port, 8081);
        assert_eq!(cfg.server_protocol, ServerProtocol::Udp);
        assert_eq!(cfg.server_path, "/push");
        assert_eq!(cfg.gnss_mode, GnssMode::Standalone);
        assert_eq!(cfg.storage, StorageMode::None);
        assert!(cfg.enable_obd);
        assert!(cfg.enable_mems);
        assert!(!cfg.enable_wifi);
        assert!(!cfg.enable_ble);
        assert!(!cfg.enable_httpd);
        assert_eq!(cfg.wifi_ap_ssid, "Freematics");
        assert!((cfg.motion_threshold - 0.4).abs() < 1e-6);
        assert_eq!(cfg.jumpstart_voltage, 14500);
        assert_eq!(cfg.cooling_down_temp, 80);
        assert_eq!(cfg.max_obd_errors, 5);
        assert_eq!(cfg.server_sync_interval, 30);
    }

    #[test]
    fn round_trips_dump_and_set_commands() {
        let mut cfg = DeviceConfig::default();
        cfg.cell_apn = "internet".to_string();
        cfg.wifi_ssid = "home".to_string();
        cfg.server_port = 8081;
        cfg.enable_wifi = true;
        let cmds = cfg.to_set_commands();
        let lines: Vec<String> = cmds
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect();
        let parsed = DeviceConfig::from_dump_lines(&lines).unwrap();
        assert_eq!(parsed.cell_apn, "internet");
        assert_eq!(parsed.wifi_ssid, "home");
        assert_eq!(parsed.server_port, 8081);
        assert!(parsed.enable_wifi);
    }
}
