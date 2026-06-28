use crate::backup::schema::BackupFile;
use crate::commands::FirmwareInfo;
use crate::protocol::client::SerialClient;
use crate::usb::serial_port::SerialPortOps;
use std::fs;
use std::io::Write;

/// Serialize a `BackupFile` to a pretty-printed JSON string.
pub fn export_to_json(backup: &BackupFile) -> Result<String, String> {
    serde_json::to_string_pretty(backup).map_err(|e| format!("failed to serialize backup: {e}"))
}

/// Dump the live config from the device and build a `BackupFile`.
pub fn export_config<P: SerialPortOps>(
    client: &mut SerialClient<P>,
    device_model: &str,
    firmware_info: &FirmwareInfo,
) -> Result<BackupFile, String> {
    let config = client.dump_config().map_err(|e| e.to_string())?;
    Ok(BackupFile::new(
        device_model,
        &firmware_info.version,
        &firmware_info.sha256,
        config,
    ))
}

/// Write a `BackupFile` as pretty JSON to `path`.
pub fn write_backup_file(path: &str, backup: &BackupFile) -> Result<(), String> {
    let json = export_to_json(backup)?;
    let mut file = fs::File::create(path).map_err(|e| format!("failed to create {path}: {e}"))?;
    file.write_all(json.as_bytes())
        .map_err(|e| format!("failed to write {path}: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::types::DeviceConfig;

    fn fixture_backup() -> BackupFile {
        BackupFile::new(
            "Freematics ONE+",
            "0.1.0",
            "957abfe3833ae9721fa0d5169e45aca2ed64023b0569d5a32c8cc15a72a1703b",
            DeviceConfig::default(),
        )
    }

    #[test]
    fn export_to_json_pretty() {
        let backup = fixture_backup();
        let json = export_to_json(&backup).unwrap();
        assert!(
            json.contains("\n  "),
            "pretty JSON should be indented with newlines"
        );
        assert!(json.starts_with('{'));
    }

    #[test]
    fn write_backup_file_writes_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backup.json");
        let path_str = path.to_str().unwrap();
        let backup = fixture_backup();
        write_backup_file(path_str, &backup).unwrap();
        let contents = std::fs::read_to_string(path).unwrap();
        assert!(contents.contains("firmware_sha256"));
        assert!(contents.contains("schema_version"));
        let parsed: BackupFile = serde_json::from_str(&contents).unwrap();
        assert_eq!(parsed, backup);
    }

    #[test]
    fn write_backup_file_fails_on_bad_path() {
        let backup = fixture_backup();
        let res = write_backup_file("/nonexistent/dir/backup.json", &backup);
        assert!(res.is_err());
    }
}
