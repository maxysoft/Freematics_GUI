use crate::backup::import::ImportOutcome;
use crate::backup::{export as backup_export, import as backup_import, BackupFile};
use crate::flash::{flash_firmware_with, CommandFlashRunner, FlashProgress, FlashRunner};
use crate::protocol::{DeviceConfig, LiveData, SerialClient};
use crate::usb::serial_port::RealSerialPort;
use crate::usb::{detect_devices, DeviceInfo};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};

/// Process-wide lock serializing access to serial ports. The OS does not give
/// us exclusive access to a tty by default, so two concurrent commands opening
/// the same port (e.g. the dashboard's 1s `get_live_data` poll overlapping a
/// config Apply) would interleave reads/writes. Holding this for the duration
/// of each port session keeps device I/O strictly sequential.
fn serial_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Run a blocking serial-port session off the async runtime.
///
/// Tauri commands run on the async (tokio) runtime; the `serialport` crate is
/// synchronous and each read can block up to the 2s timeout. Doing that work
/// directly on a runtime worker stalls every other command/event. `spawn_blocking`
/// moves it to the blocking pool, and `serial_lock()` serializes port access.
async fn with_serial<T, F>(port_path: String, f: F) -> Result<T, String>
where
    F: FnOnce(&mut SerialClient<RealSerialPort>) -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let _guard = serial_lock()
            .lock()
            .map_err(|_| "serial port lock poisoned".to_string())?;
        let port = RealSerialPort::open(&port_path).map_err(|e| e.to_string())?;
        let mut client = SerialClient::new(port);
        f(&mut client)
    })
    .await
    .map_err(|e| format!("serial task failed: {e}"))?
}

#[tauri::command]
pub async fn detect_devices_cmd() -> Result<Vec<DeviceInfo>, String> {
    Ok(detect_devices())
}

#[tauri::command]
pub async fn list_ports() -> Result<Vec<String>, String> {
    match serialport::available_ports() {
        Ok(ports) => Ok(ports.into_iter().map(|p| p.port_name).collect()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn get_config(port_path: String) -> Result<DeviceConfig, String> {
    log::info!("get_config: reading config from {port_path}");
    let r = with_serial(port_path.clone(), |client| {
        client.dump_config().map_err(|e| e.to_string())
    })
    .await;
    if let Err(e) = &r {
        log::error!("get_config({port_path}) failed: {e}");
    }
    r
}

#[tauri::command]
pub async fn set_config(port_path: String, config: DeviceConfig) -> Result<(), String> {
    log::info!("set_config: applying config to {port_path}");
    let r = with_serial(port_path.clone(), move |client| {
        for (key, val) in config.to_set_commands() {
            client.set(&key, &val).map_err(|e| e.to_string())?;
        }
        client.save_config().map_err(|e| e.to_string())
    })
    .await;
    match &r {
        Ok(()) => log::info!("set_config({port_path}) ok"),
        Err(e) => log::error!("set_config({port_path}) failed: {e}"),
    }
    r
}

#[tauri::command]
pub async fn get_live_data(port_path: String) -> Result<LiveData, String> {
    with_serial(port_path, |client| {
        client.get_live_data().map_err(|e| e.to_string())
    })
    .await
}

/// Metadata about the bundled patched firmware.
#[derive(Debug, Clone, Serialize)]
pub struct FirmwareInfo {
    pub version: String,
    pub sha256: String,
    pub binary: String,
    pub built_from_commit: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FlashProgressEvent {
    pub percentage: u8,
    pub stage: String,
}

/// Resolve the bundled firmware dist directory.
///
/// In a packaged app the `firmware/dist/` files are bundled as Tauri
/// resources, so we resolve them via the resource directory. In dev mode
/// (or if resource resolution fails) we fall back to `firmware/dist/`
/// relative to the current working directory.
fn firmware_dist_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    match app
        .path()
        .resolve("firmware/dist", tauri::path::BaseDirectory::Resource)
    {
        Ok(p) => Ok(p),
        Err(_) => {
            // Dev fallback: look in the workspace root next to src-tauri.
            let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
            Ok(cwd.join("firmware").join("dist"))
        }
    }
}

/// Read the bundled `manifest.json` and return its parsed contents.
#[tauri::command]
pub fn get_firmware_info(app: tauri::AppHandle) -> Result<FirmwareInfo, String> {
    let manifest_path = firmware_dist_dir(&app)?.join("manifest.json");
    let raw = fs::read_to_string(&manifest_path).map_err(|e| {
        format!(
            "failed to read manifest at {}: {e}",
            manifest_path.display()
        )
    })?;
    let value: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(FirmwareInfo {
        version: value
            .get("version")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string(),
        sha256: value
            .get("sha256")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        binary: value
            .get("binary")
            .and_then(|v| v.as_str())
            .unwrap_or("telelogger-patched.bin")
            .to_string(),
        built_from_commit: value
            .get("built_from_commit")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string(),
    })
}

/// Flash firmware to `port`, streaming progress events on `flash://progress`.
///
/// With `firmware_path` = None the bundled, SHA-verified patched image is used.
/// With Some(path) the user-selected `.bin` is flashed as-is (no SHA gate —
/// it's their file). Errors clearly if no firmware is available.
#[tauri::command]
pub async fn flash_firmware_cmd(
    port: String,
    firmware_path: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let data = match firmware_path {
        Some(p) => {
            log::info!("flashing user-selected firmware: {p}");
            if !Path::new(&p).exists() {
                return Err(format!("firmware file not found: {p}"));
            }
            std::fs::read(&p).map_err(|e| format!("failed to read firmware {p}: {e}"))?
        }
        None => {
            let info = get_firmware_info(app.clone())?;
            let binary_path = firmware_dist_dir(&app)?.join(&info.binary);
            let binary_str = binary_path
                .to_str()
                .ok_or_else(|| "binary path is not valid UTF-8".to_string())?
                .to_string();
            // SHA-verify the bundled image before touching the device.
            if !Path::new(&binary_str).exists() {
                return Err(format!(
                    "bundled firmware not found at {binary_str} — choose a .bin file to flash"
                ));
            }
            match crate::flash::verify_sha256(&binary_str, &info.sha256) {
                Ok(true) => {}
                Ok(false) => {
                    return Err("bundled firmware SHA256 mismatch — refusing to flash".to_string())
                }
                Err(e) => return Err(e),
            }
            std::fs::read(&binary_str).map_err(|e| format!("failed to read firmware: {e}"))?
        }
    };
    if data.is_empty() {
        return Err("firmware file is empty".to_string());
    }
    log::info!("flashing {} bytes to {port}", data.len());

    // Flash natively (espflash) off the async runtime; serialize against other
    // serial access. Progress events stream to the `flash://progress` channel.
    let emitter = app.clone();
    let result = tokio::task::spawn_blocking(move || {
        let _guard = serial_lock()
            .lock()
            .map_err(|_| "serial port lock poisoned".to_string())?;
        let mut last_pct = 0u8;
        crate::flash::flash_bin(&port, &data, |pct| {
            if pct != last_pct {
                last_pct = pct;
                let _ = emitter.emit(
                    "flash://progress",
                    FlashProgressEvent {
                        percentage: pct,
                        stage: if pct >= 100 { "done".into() } else { "writing".into() },
                    },
                );
            }
        })
    })
    .await
    .map_err(|e| format!("flash task failed: {e}"))?;

    match result {
        Ok(()) => {
            let _ = app.emit(
                "flash://progress",
                FlashProgressEvent {
                    percentage: 100,
                    stage: "done".to_string(),
                },
            );
            Ok(())
        }
        Err(e) => {
            let _ = app.emit(
                "flash://progress",
                FlashProgressEvent {
                    percentage: 0,
                    stage: format!("error: {e}"),
                },
            );
            log::error!("flash_firmware_cmd failed: {e}");
            Err(e)
        }
    }
}

/// Test helper: run flashing with an injected runner and emit progress.
/// Kept out of the public command surface but exercised by unit tests.
#[cfg(test)]
pub(crate) fn run_flash_with_runner<R: FlashRunner>(
    runner: &mut R,
    port: &str,
    binary_path: &str,
    expected_sha256: &str,
) -> Result<Option<FlashProgress>, String> {
    let output_holder: Option<String>;
    // We can't capture streaming output from the trait without changing it,
    // so for tests we just call flash_firmware_with and return None on success.
    match flash_firmware_with(runner, port, binary_path, expected_sha256) {
        Ok(()) => {
            output_holder = None;
            Ok(output_holder.and_then(|o| FlashProgress::parse(&o)))
        }
        Err(e) => Err(e),
    }
}

/// Export the live device config to a versioned JSON backup file at `save_path`.
#[tauri::command]
pub async fn export_config_cmd(
    port_path: String,
    save_path: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let firmware_info = get_firmware_info(app)?;
    with_serial(port_path, move |client| {
        let backup = backup_export::export_config(client, "Freematics ONE+", &firmware_info)?;
        backup_export::write_backup_file(&save_path, &backup)
    })
    .await
}

/// Import a backup JSON file and apply it to the device via CFG= commands,
/// then CFG_SAVE. Returns warnings (e.g. firmware hash mismatch) without
/// failing the import.
#[tauri::command]
pub async fn import_config_cmd(
    port_path: String,
    load_path: String,
    app: tauri::AppHandle,
) -> Result<ImportOutcome, String> {
    let backup: BackupFile = backup_import::read_backup_file(&load_path)?;
    let firmware_info = get_firmware_info(app)?;
    with_serial(port_path, move |client| {
        backup_import::import_config(client, &backup, &firmware_info.sha256)
    })
    .await
}

/// Open a native "save file" dialog and return the chosen path (or `None` if
/// cancelled). Runs off the main thread via `spawn_blocking`; the dialog
/// plugin marshals the actual UI back to the main thread internally.
#[tauri::command]
pub async fn pick_save_path(
    app: tauri::AppHandle,
    default_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("JSON", &["json"])
            .set_file_name(&default_name)
            .blocking_save_file()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("dialog task failed: {e}"))
}

/// Open a native "open file" dialog and return the chosen path (or `None`).
#[tauri::command]
pub async fn pick_open_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("JSON", &["json"])
            .blocking_pick_file()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("dialog task failed: {e}"))
}

/// Open a native dialog to pick a firmware `.bin` file (or `None` if cancelled).
#[tauri::command]
pub async fn pick_firmware_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Firmware", &["bin"])
            .blocking_pick_file()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("dialog task failed: {e}"))
}

/// A unique, OS-appropriate temp path for the flash wizard's transient backup
/// (replaces the previous hardcoded, Linux-only `/tmp` path).
#[tauri::command]
pub fn temp_backup_path() -> Result<String, String> {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut path = std::env::temp_dir();
    path.push(format!("freematics-backup-{secs}.json"));
    Ok(path.to_string_lossy().into_owned())
}
