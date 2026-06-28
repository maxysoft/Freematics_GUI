use crate::protocol::types::DeviceConfig;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: &str = "1";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct BackupFile {
    pub schema_version: String,
    pub device_model: String,
    pub firmware_version: String,
    pub firmware_sha256: String,
    pub exported_at: String,
    pub config: DeviceConfig,
}

impl BackupFile {
    pub fn new(
        device_model: impl Into<String>,
        firmware_version: impl Into<String>,
        firmware_sha256: impl Into<String>,
        config: DeviceConfig,
    ) -> Self {
        let now: DateTime<Utc> = Utc::now();
        Self {
            schema_version: SCHEMA_VERSION.to_string(),
            device_model: device_model.into(),
            firmware_version: firmware_version.into(),
            firmware_sha256: firmware_sha256.into(),
            exported_at: now.to_rfc3339(),
            config,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::types::{GnssMode, ServerProtocol, StorageMode};

    fn sample_config() -> DeviceConfig {
        let mut cfg = DeviceConfig::default();
        cfg.cell_apn = "internet".to_string();
        cfg.wifi_ssid = "home".to_string();
        cfg.wifi_password = "secret".to_string();
        cfg.server_host = "hub.freematics.com".to_string();
        cfg.server_port = 8081;
        cfg.server_protocol = ServerProtocol::Udp;
        cfg.server_path = "/push".to_string();
        cfg.gnss_mode = GnssMode::Standalone;
        cfg.storage = StorageMode::None;
        cfg.enable_obd = true;
        cfg.enable_mems = true;
        cfg.enable_wifi = false;
        cfg.enable_ble = false;
        cfg.enable_httpd = false;
        cfg.sim_pin = String::new();
        cfg.apn_username = String::new();
        cfg.apn_password = String::new();
        cfg.wifi_ap_ssid = "Freematics".to_string();
        cfg.wifi_ap_password = String::new();
        cfg.motion_threshold = 0.4;
        cfg.jumpstart_voltage = 14500;
        cfg.cooling_down_temp = 80;
        cfg.gnss_always_on = false;
        cfg.gnss_reset_timeout = 0;
        cfg.max_obd_errors = 5;
        cfg.server_sync_interval = 30;
        cfg.ping_back_interval = 0;
        cfg.board_has_psram = false;
        cfg
    }

    fn sample_backup() -> BackupFile {
        BackupFile::new(
            "Freematics ONE+",
            "0.1.0",
            "957abfe3833ae9721fa0d5169e45aca2ed64023b0569d5a32c8cc15a72a1703b",
            sample_config(),
        )
    }

    #[test]
    fn serializes_all_config_fields() {
        let backup = sample_backup();
        let json = serde_json::to_string(&backup).unwrap();
        for field in [
            "cell_apn",
            "wifi_ssid",
            "wifi_password",
            "server_host",
            "server_port",
            "server_protocol",
            "server_path",
            "gnss_mode",
            "storage",
            "enable_obd",
            "enable_mems",
            "enable_wifi",
            "enable_ble",
            "enable_httpd",
            "sim_pin",
            "apn_username",
            "apn_password",
            "wifi_ap_ssid",
            "wifi_ap_password",
            "motion_threshold",
            "jumpstart_voltage",
            "cooling_down_temp",
            "gnss_always_on",
            "gnss_reset_timeout",
            "max_obd_errors",
            "server_sync_interval",
            "ping_back_interval",
            "board_has_psram",
        ] {
            assert!(json.contains(field), "json missing field: {field}");
        }
    }

    #[test]
    fn includes_firmware_hash() {
        let backup = sample_backup();
        let json = serde_json::to_string(&backup).unwrap();
        assert!(json.contains("firmware_sha256"));
        assert!(
            json.contains("957abfe3833ae9721fa0d5169e45aca2ed64023b0569d5a32c8cc15a72a1703b"),
            "json must contain the firmware sha256 value"
        );
    }

    #[test]
    fn round_trips_serialize_deserialize() {
        let backup = sample_backup();
        let json = serde_json::to_string(&backup).unwrap();
        let parsed: BackupFile = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.schema_version, backup.schema_version);
        assert_eq!(parsed.device_model, backup.device_model);
        assert_eq!(parsed.firmware_version, backup.firmware_version);
        assert_eq!(parsed.firmware_sha256, backup.firmware_sha256);
        assert_eq!(parsed.exported_at, backup.exported_at);
        assert_eq!(parsed.config, backup.config);
    }

    #[test]
    fn new_sets_schema_version_one() {
        let backup = sample_backup();
        assert_eq!(backup.schema_version, "1");
    }

    #[test]
    fn new_sets_exported_at_nonempty() {
        let backup = sample_backup();
        assert!(!backup.exported_at.is_empty());
    }
}
