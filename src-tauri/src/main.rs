// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backup;
mod commands;
mod flash;
mod protocol;
mod usb;

fn main() {
    // Force software rendering for WebKit2GTK compatibility across VMs / headless / weak-GPU hosts.
    // Must run before any GTK/WebKit init. Harmless on Windows (no-op for those env vars).
    #[cfg(target_os = "linux")]
    {
        use std::sync::Once;
        static SET_ENV: Once = Once::new();
        SET_ENV.call_once(|| {
            // WebKit2GTK >= 2.42 uses a dmabuf renderer that calls eglGetDisplay() which
            // fails in VirtualBox / headless / no-DRI environments ("EGL_BAD_PARAMETER").
            // Disabling it falls back to the stable shared-memory path.
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            // Older WebKit compositing path also touches EGL; disable for safety.
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
            // Prefer the software (llvmpipe) Mesa driver when available.
            if std::env::var("LIBGL_ALWAYS_SOFTWARE").is_err() {
                std::env::set_var("LIBGL_ALWAYS_SOFTWARE", "1");
            }
            // Force X11 backend (Wayland EGL path is more fragile in VMs).
            if std::env::var("GDK_BACKEND").is_err() {
                std::env::set_var("GDK_BACKEND", "x11");
            }
        });
    }

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                // Beta diagnostics: verbose logging to a rotating file in the OS
                // log dir, plus stdout (dev) and the webview console. On Windows
                // the file lands in %APPDATA%\com.maxynetwork.freematics-config-manager\logs.
                .level(log::LevelFilter::Debug)
                // serialport's internals are noisy at debug; keep them at info.
                .level_for("serialport", log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("freematics-config-manager".into()),
                    }),
                ])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::detect_devices_cmd,
            commands::list_ports,
            commands::get_config,
            commands::set_config,
            commands::get_live_data,
            commands::get_firmware_info,
            commands::flash_firmware_cmd,
            commands::export_config_cmd,
            commands::import_config_cmd,
            commands::pick_save_path,
            commands::pick_open_path,
            commands::temp_backup_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
