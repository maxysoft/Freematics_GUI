use crate::backup::schema::{BackupFile, SCHEMA_VERSION};
use crate::protocol::client::SerialClient;
use crate::usb::serial_port::SerialPortOps;
use serde::{Deserialize, Serialize};
use std::fs;

/// Outcome of an import operation. Warnings (e.g. firmware hash mismatch)
/// are reported without failing the import.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportOutcome {
    Success,
    SuccessWithWarnings(Vec<String>),
}

impl ImportOutcome {
    pub fn warnings(&self) -> &[String] {
        match self {
            ImportOutcome::Success => &[],
            ImportOutcome::SuccessWithWarnings(w) => w,
        }
    }
}

/// Parse a backup JSON string and validate the schema version.
pub fn parse_backup_json(json: &str) -> Result<BackupFile, String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("invalid backup JSON: {e}"))?;
    let schema_version = value
        .get("schema_version")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing schema_version field".to_string())?;
    if schema_version != SCHEMA_VERSION {
        return Err(format!(
            "unsupported schema_version: {} (expected {})",
            schema_version, SCHEMA_VERSION
        ));
    }
    serde_json::from_value::<BackupFile>(value)
        .map_err(|e| format!("invalid backup contents: {e}"))
}

/// Validate an imported config before any of it is written to the device.
///
/// A backup deserialized with `#[serde(default)]` can carry out-of-range or
/// nonsensical values (corrupt/hand-edited file); applying those to the device
/// could brick its config. Reject clearly invalid values up front. Ranges are
/// intentionally lenient — they only catch garbage, not policy.
pub fn validate_config(cfg: &crate::protocol::types::DeviceConfig) -> Result<(), String> {
    if cfg.jumpstart_voltage < 0 || cfg.jumpstart_voltage > 30_000 {
        return Err(format!(
            "jumpstart_voltage out of range (0-30000 mV): {}",
            cfg.jumpstart_voltage
        ));
    }
    if cfg.cooling_down_temp < -40 || cfg.cooling_down_temp > 150 {
        return Err(format!(
            "cooling_down_temp out of range (-40-150 °C): {}",
            cfg.cooling_down_temp
        ));
    }
    if !cfg.motion_threshold.is_finite() || cfg.motion_threshold < 0.0 {
        return Err(format!(
            "motion_threshold must be a non-negative number: {}",
            cfg.motion_threshold
        ));
    }
    for (name, v) in [
        ("gnss_reset_timeout", cfg.gnss_reset_timeout),
        ("max_obd_errors", cfg.max_obd_errors),
        ("server_sync_interval", cfg.server_sync_interval),
        ("ping_back_interval", cfg.ping_back_interval),
    ] {
        if v < 0 {
            return Err(format!("{name} must be non-negative: {v}"));
        }
    }
    Ok(())
}

/// Apply every config field via `CFG=key=val` then `CFG_SAVE`.
///
/// `current_firmware_sha256` is compared against the backup's hash; a
/// mismatch produces a warning rather than an error. The config is validated
/// before any write, so a corrupt backup fails without touching the device.
pub fn import_config<P: SerialPortOps>(
    client: &mut SerialClient<P>,
    backup: &BackupFile,
    current_firmware_sha256: &str,
) -> Result<ImportOutcome, String> {
    validate_config(&backup.config)?;

    let mut warnings: Vec<String> = Vec::new();

    if !current_firmware_sha256.is_empty()
        && !backup.firmware_sha256.is_empty()
        && current_firmware_sha256 != backup.firmware_sha256
    {
        warnings.push(format!(
            "firmware sha256 mismatch: backup={} current={}",
            backup.firmware_sha256, current_firmware_sha256
        ));
    }

    for (key, val) in backup.config.to_set_commands() {
        client
            .set(&key, &val)
            .map_err(|e| format!("failed to set {key}: {e}"))?;
    }
    client
        .save_config()
        .map_err(|e| format!("failed to save config: {e}"))?;

    if warnings.is_empty() {
        Ok(ImportOutcome::Success)
    } else {
        Ok(ImportOutcome::SuccessWithWarnings(warnings))
    }
}

/// Read a backup file from disk and parse it.
pub fn read_backup_file(path: &str) -> Result<BackupFile, String> {
    let contents =
        fs::read_to_string(path).map_err(|e| format!("failed to read {path}: {e}"))?;
    parse_backup_json(&contents)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::export::export_to_json;
    use crate::protocol::types::DeviceConfig;
    use std::collections::VecDeque;
    use std::io::{self, Cursor, Read, Write};
    use std::time::Duration;

    fn fixture_backup() -> BackupFile {
        BackupFile::new(
            "Freematics ONE+",
            "0.1.0",
            "957abfe3833ae9721fa0d5169e45aca2ed64023b0569d5a32c8cc15a72a1703b",
            DeviceConfig::default(),
        )
    }

    #[test]
    fn parse_backup_json_valid() {
        let backup = fixture_backup();
        let json = serde_json::to_string(&backup).unwrap();
        let parsed = parse_backup_json(&json).unwrap();
        assert_eq!(parsed.schema_version, "1");
        assert_eq!(parsed.device_model, backup.device_model);
        assert_eq!(parsed.config, backup.config);
    }

    #[test]
    fn parse_backup_json_wrong_version() {
        let json = r#"{
            "schema_version": "2",
            "device_model": "x",
            "firmware_version": "0.1.0",
            "firmware_sha256": "abc",
            "exported_at": "2026-01-01T00:00:00+00:00",
            "config": null
        }"#;
        let res = parse_backup_json(json);
        assert!(res.is_err());
        let err = res.unwrap_err();
        assert!(err.contains("unsupported schema_version"), "got: {err}");
    }

    #[test]
    fn parse_backup_json_malformed() {
        let res = parse_backup_json("{ not valid json");
        assert!(res.is_err());
    }

    #[test]
    fn round_trips_export_import() {
        let backup = fixture_backup();
        let json = export_to_json(&backup).unwrap();
        let parsed = parse_backup_json(&json).unwrap();
        assert_eq!(parsed.schema_version, backup.schema_version);
        assert_eq!(parsed.device_model, backup.device_model);
        assert_eq!(parsed.firmware_version, backup.firmware_version);
        assert_eq!(parsed.firmware_sha256, backup.firmware_sha256);
        assert_eq!(parsed.exported_at, backup.exported_at);
        assert_eq!(parsed.config, backup.config);
    }

    /// Mock serial port mirroring the one in `protocol/client.rs` tests.
    struct MockPort {
        read_buf: Cursor<Vec<u8>>,
        write_buf: Vec<u8>,
        responses: VecDeque<Vec<u8>>,
    }

    impl MockPort {
        fn new(responses: Vec<Vec<u8>>) -> Self {
            let initial = responses.first().cloned().unwrap_or_default();
            Self {
                read_buf: Cursor::new(initial),
                write_buf: Vec::new(),
                responses: responses.into_iter().skip(1).collect(),
            }
        }

        fn write_buf(&self) -> &[u8] {
            &self.write_buf
        }
    }

    impl Read for MockPort {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            let n = self.read_buf.read(buf)?;
            if n == 0 {
                if let Some(next) = self.responses.pop_front() {
                    self.read_buf = Cursor::new(next);
                    return self.read_buf.read(buf);
                }
            }
            Ok(n)
        }
    }

    impl Write for MockPort {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.write_buf.extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl SerialPortOps for MockPort {
        fn set_timeout(&mut self, _timeout: Duration) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn import_config_applies_each_set_command() {
        let backup = fixture_backup();
        let set_cmds = backup.config.to_set_commands();

        // One "OK\r" per set command, plus one for CFG_SAVE.
        let mut responses: Vec<Vec<u8>> = set_cmds
            .iter()
            .map(|_| b"OK\r".to_vec())
            .collect();
        responses.push(b"OK\r".to_vec());

        let mut client = SerialClient::new(MockPort::new(responses));
        let outcome =
            import_config(&mut client, &backup, &backup.firmware_sha256).unwrap();
        assert_eq!(outcome, ImportOutcome::Success);

        let written = String::from_utf8_lossy(client.port_ref().write_buf());

        for (key, val) in &set_cmds {
            let expected = format!("{key}={val}\r");
            assert!(
                written.contains(&expected),
                "write buffer missing set command: {expected}"
            );
        }
        assert!(
            written.contains("CFG_SAVE\r"),
            "write buffer must contain CFG_SAVE; got: {written}"
        );
    }

    #[test]
    fn import_config_warns_on_firmware_hash_mismatch() {
        let backup = fixture_backup();
        let set_cmds = backup.config.to_set_commands();
        let mut responses: Vec<Vec<u8>> = set_cmds
            .iter()
            .map(|_| b"OK\r".to_vec())
            .collect();
        responses.push(b"OK\r".to_vec());

        let mut client = SerialClient::new(MockPort::new(responses));
        let outcome = import_config(&mut client, &backup, "deadbeef").unwrap();
        match outcome {
            ImportOutcome::SuccessWithWarnings(w) => {
                assert!(
                    w.iter().any(|m| m.contains("firmware sha256 mismatch")),
                    "expected firmware mismatch warning, got: {w:?}"
                );
            }
            other => panic!("expected warnings, got {other:?}"),
        }
    }

    #[test]
    fn import_config_no_warning_when_current_hash_empty() {
        let backup = fixture_backup();
        let set_cmds = backup.config.to_set_commands();
        let mut responses: Vec<Vec<u8>> = set_cmds
            .iter()
            .map(|_| b"OK\r".to_vec())
            .collect();
        responses.push(b"OK\r".to_vec());

        let mut client = SerialClient::new(MockPort::new(responses));
        let outcome = import_config(&mut client, &backup, "").unwrap();
        assert_eq!(outcome, ImportOutcome::Success);
    }

    #[test]
    fn read_backup_file_reads_and_parses() {
        let backup = fixture_backup();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backup.json");
        std::fs::write(&path, serde_json::to_string_pretty(&backup).unwrap()).unwrap();
        let parsed = read_backup_file(path.to_str().unwrap()).unwrap();
        assert_eq!(parsed.schema_version, backup.schema_version);
        assert_eq!(parsed.config, backup.config);
    }

    #[test]
    fn read_backup_file_missing_path_errors() {
        let res = read_backup_file("/nonexistent/backup.json");
        assert!(res.is_err());
    }

    #[test]
    fn validate_config_accepts_defaults() {
        assert!(validate_config(&DeviceConfig::default()).is_ok());
    }

    #[test]
    fn import_rejects_out_of_range_config_without_writing() {
        let mut backup = fixture_backup();
        backup.config.jumpstart_voltage = 999_999; // garbage

        // No serial responses queued: if import touched the port it would
        // error on read, but validation must fail first.
        let mut client = SerialClient::new(MockPort::new(vec![]));
        let res = import_config(&mut client, &backup, &backup.firmware_sha256);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("jumpstart_voltage"));
        assert!(
            client.port_ref().write_buf().is_empty(),
            "no config should be written when validation fails"
        );
    }
}
