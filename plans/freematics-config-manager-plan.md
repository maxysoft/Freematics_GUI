## Plan: Freematics Config Manager

A cross-platform (Windows/Linux) **portable** Tauri desktop app (no install — just launch the executable) that autodetects the Freematics ONE+ over USB (CH341 1a86:7523), manages the **full** config parameter set, backs up/restores config as JSON (with firmware SHA256), and one-click reflashes a patched firmware that exposes a serial command protocol. All development runs in Docker; Windows portable `.exe` and Linux portable `.AppImage` are built via GitHub Actions on push to `release`.

**Phases 9**

1. **Phase 1: Project scaffolding + Docker dev env**
    - **Objective:** Bootstrap Tauri (Rust + web frontend) project, Dockerfile for dev, GitHub Actions release workflow. No host installs.
    - **Files/Functions to Modify/Create:** `Dockerfile`, `docker-compose.yml`, `Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`, `package.json`, `.github/workflows/release.yml`, `AGENTS.md`, `.gitignore`
    - **Tests to Write:** `tests/docker_env.rs` (verify cargo builds in container), `tests/project_layout.rs` (assert expected dirs exist)
    - **Steps:**
        1. Write `Dockerfile` (Rust + Node + Linux build deps for Tauri: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`, etc.) and `docker-compose.yml` mounting workspace.
        2. Scaffold Tauri app inside container: `src-tauri/` with `main.rs` stub, `tauri.conf.json` (productName `Freematics Config Manager`, identifier `com.maxynetwork.freematics-config-manager`), frontend `src/` (vanilla TS + Vite, no heavy framework).
        3. Write `AGENTS.md` specifying `plans/` as plan dir, Docker-only policy, caveman ultra.
        4. Write `.github/workflows/release.yml`: on push to `release` branch, build in `ubuntu-latest` + `windows-latest` containers, upload `.exe`/`.AppImage`/`.deb` as release assets.
        5. Verify `docker compose run dev cargo tauri info` succeeds.

2. **Phase 2: USB device autodetection (Rust backend)**
    - **Objective:** Detect CH341 (VID 1a86, PID 7523) on Linux (`/dev/ttyUSB*`) and Windows (`COM*`), enumerate candidate ports, expose to frontend.
    - **Files/Functions to Modify/Create:** `src-tauri/src/usb/mod.rs`, `src-tauri/src/usb/detector.rs`, `src-tauri/src/usb/serial_port.rs`, `src-tauri/src/commands.rs` (`detect_devices`, `list_ports`), `src-tauri/Cargo.toml` (add `serialport`, `nusb`, `tokio`)
    - **Tests to Write:** `src-tauri/src/usb/detector.rs` (`detects_ch341_by_vid_pid`, `filters_non_ch341`, `handles_no_device`), `src-tauri/src/usb/serial_port.rs` (`opens_port_at_115200`, `fails_gracefully_on_busy_port`)
    - **Steps:**
        1. Add deps: `serialport = "4"`, `nusb = "0.1"`, `tokio = { version="1", features=["full"] }`.
        2. `detector.rs`: enumerate USB devices via `nusb::list_devices()`, filter VID `0x1a86` & PID `0x7523`, map to OS port path.
        3. `serial_port.rs`: wrap `serialport::open` at 115200/8N1/no-flow, expose async read/write via tokio task.
        4. `commands.rs`: `#[tauri::command] detect_devices() -> Vec<DeviceInfo>` returning JSON to frontend.
        5. Tests use `mockall`-style fakes for `nusb` enumeration; real device test gated behind `--ignored`.

3. **Phase 3: Serial command protocol (Rust ↔ device)**
    - **Objective:** Implement the AT-style text protocol client (mirror of firmware `processBLE()`): `APN?`, `APN=`, `SSID?`, `SSID=`, `WPWD?`, `WPWD=`, plus new commands the patched firmware will add (`CFG?`, `CFG=key=val`, `CFG_DUMP`, `CFG_LOAD`, `CFG_SAVE`, `BATT`, `RSSI`, `VIN`, `LAT/LNG/...`). Framing: `\r`-terminated, `\r`-terminated responses, 2s timeout.
    - **Files/Functions to Modify/Create:** `src-tauri/src/protocol/mod.rs`, `src-tauri/src/protocol/client.rs`, `src-tauri/src/protocol/commands.rs`, `src-tauri/src/protocol/types.rs` (config struct mirroring all params), `src-tauri/src/commands.rs` (`get_config`, `set_config`, `get_live_data`)
    - **Tests to Write:** `client.rs` (`sends_query_terminates_with_cr`, `parses_ok_response`, `times_out_on_no_response`, `handles_err_response`, `escapes_values_in_set`), `commands.rs` (`cfg_dump_parses_full_config`, `cfg_set_round_trips`)
    - **Steps:**
        1. `types.rs`: `DeviceConfig` struct with all params from research (APN, SSID, WPWD, server host/port/protocol/path, GNSS mode, storage, OBD, MEMS, SIM PIN, motion threshold, intervals, etc.) + serde.
        2. `client.rs`: `SerialClient` holding port handle, `send(cmd: &str) -> Result<String>`, `query(key)`, `set(key, val)`.
        3. `commands.rs`: `CFG_DUMP` → parse into `DeviceConfig`; `CFG=key=val` → set single; `CFG_SAVE` → persist to NVS.
        4. Tests against a fake serial echo loopback (in-process `tokio::io::duplex`) seeded with canned responses.

4. **Phase 4: Patched firmware (serial command handler + extended NVS)**
    - **Objective:** Fork `firmware_v5/telelogger`, add `processSerial()` mirroring `processBLE()`, extend NVS storage to all config params, add `CFG_DUMP`/`CFG_LOAD`/`CFG_SAVE`/`CFG=` commands. Build via PlatformIO in Docker.
    - **Files/Functions to Modify/Create:** `firmware/telelogger/telelogger.ino` (add `processSerial()`, call from `loop()`), `firmware/telelogger/config.h` (add `CONFIG_MODE_SERIAL`), `firmware/telelogger/configstore.h/.cpp` (new: NVS read/write for all params), `firmware/telelogger/platformio.ini` (board env), `firmware/Dockerfile` (PlatformIO build), `firmware/build.sh`
    - **Tests to Write:** `firmware/test/configstore_test.cpp` (host-side unit test of NVS key serialization using a mock store), `firmware/test/protocol_test.cpp` (parse `CFG_DUMP` output line format)
    - **Steps:**
        1. `configstore.h`: `Config` struct + `load()/save()/dump()` over NVS namespace `"cfg"` (keys: `apn`,`ssid`,`wpwd`,`srv_host`,`srv_port`,`srv_proto`,`srv_path`,`gnss`,`storage`,`obd`,`mems`,`sim_pin`,`motion_thr`,...).
        2. `processSerial()`: read line from `Serial`, dispatch `CFG?`/`CFG=`/`CFG_DUMP`/`CFG_SAVE`/`CFG_LOAD`/`BATT`/`RSSI`/`VIN`/`LAT`/...; reuse existing handlers.
        3. `config.h`: `#define ENABLE_SERIAL_CMD 1`, defaults pulled from NVS with compile-time fallback.
        4. `Dockerfile`: `python:3.11` + `platformio` pip install; `build.sh` runs `pio run -e esp32`.
        5. Verify build in Docker; flash to real device (manual, `--ignored` test) and confirm `CFG_DUMP` returns JSON-ish lines.

5. **Phase 5: Firmware flash command (esptool integration)**
    - **Objective:** One-click "Flash patched firmware" button: app downloads/bundles the patched `.bin`, calls `esptool.py` (bundled or via Docker) to flash over the detected CH341 port.
    - **Files/Functions to Modify/Create:** `src-tauri/src/flash/mod.rs`, `src-tauri/src/flash/esptool.rs`, `src-tauri/src/commands.rs` (`flash_firmware`, `get_firmware_info`), `firmware/dist/` (prebuilt `.bin` + `manifest.json` with SHA256), `src-tauri/Cargo.toml` (add `sha2`, `reqwest` for optional download)
    - **Tests to Write:** `esptool.rs` (`builds_correct_cli_args`, `verifies_sha256_before_flash`, `reports_progress_events`), `commands.rs` (`flash_firmware_returns_ok_on_success`)
    - **Steps:**
        1. `esptool.rs`: spawn `esptool.py --port <p> --baud 921600 write_flash 0x10000 firmware.bin`, parse stderr for progress %, stream via Tauri events.
        2. `manifest.json`: `{ "version": "...", "sha256": "...", "binary": "telelogger-patched.bin", "built_from_commit": "..." }`.
        3. `flash_firmware` command: verify SHA256, confirm port, run esptool, emit `flash://progress` events.
        4. Tests mock `std::process::Command` via a trait; real flash is `--ignored`.

6. **Phase 6: Backup/restore (JSON + firmware hash)**
    - **Objective:** Export full `DeviceConfig` to a versioned JSON file with firmware SHA256; import restores all params via `CFG=` commands then `CFG_SAVE`.
    - **Files/Functions to Modify/Create:** `src-tauri/src/backup/mod.rs`, `src-tauri/src/backup/export.rs`, `src-tauri/src/backup/import.rs`, `src-tauri/src/backup/schema.rs` (`BackupFile` struct: `version`, `device_model`, `firmware_sha256`, `firmware_version`, `config: DeviceConfig`, `exported_at`), `src-tauri/src/commands.rs` (`export_config`, `import_config`)
    - **Tests to Write:** `export.rs` (`serializes_all_config_fields`, `includes_firmware_hash`), `import.rs` (`round_trips_export_import`, `warns_on_firmware_hash_mismatch`, `applies_each_cfg_set_command`)
    - **Steps:**
        1. `schema.rs`: `BackupFile` v1, serde with field rename to snake_case.
        2. `export.rs`: `CFG_DUMP` → `DeviceConfig` → `BackupFile` → write JSON via `serde_json` + `sha2`.
        3. `import.rs`: load JSON, validate schema version, for each field issue `CFG=key=val`, then `CFG_SAVE`; emit per-field progress.
        4. Tests use fixture JSON files in `tests/fixtures/`.

7. **Phase 7: Frontend UI (device dashboard + config forms)**
    - **Objective:** User-friendly UI: device connection screen (autodetect + connect), tabbed dashboard (Live Data, Network, Server, Hardware, Backup), live telemetry gauges, form validation, dark theme.
    - **Files/Functions to Modify/Create:** `src/main.ts`, `src/styles.css`, `src/views/connect.ts`, `src/views/dashboard.ts`, `src/views/network.ts`, `src/views/server.ts`, `src/views/hardware.ts`, `src/views/backup.ts`, `src/components/gauge.ts`, `src/components/form-field.ts`, `src/lib/tauri.ts` (invoke wrappers), `index.html`
    - **Tests to Write:** `src/views/connect.test.ts` (`renders_detected_devices`, `disables_connect_when_none`), `src/views/network.test.ts` (`validates_ssid_length`, `shows_apn_help`), `src/views/backup.test.ts` (`triggers_export_download`, `confirms_before_import`)
    - **Steps:**
        1. Vite + TS + Vitest setup; minimal CSS (system font, dark palette, no heavy framework).
        2. `connect.ts`: poll `detect_devices` on mount, list cards, "Connect" → opens serial client.
        3. `dashboard.ts`: live data (BATT, RSSI, GPS, VIN, OBD PIDs) via `get_live_data` polled every 1s; gauges.
        4. `network.ts`/`server.ts`/`hardware.ts`: forms bound to `DeviceConfig`, "Apply" → `set_config` per changed field.
        5. `backup.ts`: Export (file save dialog), Import (file open + confirm + progress bar).
        6. Accessibility: labels, keyboard nav, ARIA on gauges.

8. **Phase 8: Live monitoring + firmware flash UI integration**
    - **Objective:** Wire live telemetry streaming (Tauri events) to dashboard; add "Flash Firmware" wizard (warn → backup current config → flash → restore config).
    - **Files/Functions to Modify/Create:** `src/views/flash-wizard.ts`, `src/lib/events.ts` (event listeners for `live://data`, `flash://progress`), `src-tauri/src/commands.rs` (`start_live_stream`, `stop_live_stream`)
    - **Tests to Write:** `flash-wizard.test.ts` (`shows_warning_first`, `disables_until_backup_done`, `displays_progress_bar`), `events.test.ts` (`parses_live_data_event`)
    - **Steps:**
        1. `start_live_stream`: tokio task polls `BATT`/`RSSI`/`LAT`/`VIN`/etc. every 1s, emits `live://data` events.
        2. `flash-wizard.ts`: 4 steps (Warning → Backup → Flash → Restore), progress bars bound to `flash://progress`.
        3. Stop stream on disconnect/unmount.

9. **Phase 9: Packaging + GitHub Actions release (portable)**
    - **Objective:** Produce **portable** Windows `.exe` (single-file, no installer — Tauri `app` target, not NSIS/MSI) and Linux `.AppImage` (also portable, no install), all built in CI on push to `release` branch; auto-create GitHub Release with assets. No admin/install required — user downloads, double-clicks, runs.
    - **Files/Functions to Modify/Create:** `.github/workflows/release.yml` (finalize), `src-tauri/tauri.conf.json` (bundle targets = `["app","appimage"]` — `app` = portable exe on Windows, `appimage` = portable on Linux; NO nsis/msi/deb), `scripts/build-firmware.yml` (separate workflow to rebuild patched firmware `.bin` + manifest on firmware changes), `README.md`, `docs/user-guide.md`
    - **Tests to Write:** `.github/workflows/release.yml` smoke (CI self-test via `act` in Docker), `tests/e2e.rs` (launch app headless, assert window title)
    - **Steps:**
        1. `tauri.conf.json`: `bundle.targets = ["app","appimage"]` (portable only — no installers). Windows produces a standalone `.exe` in `release/`; Linux produces `.AppImage` that runs without install.
        2. `release.yml`: matrix `ubuntu-latest` + `windows-latest`, install Rust+Node in runner, `cargo tauri build`, upload the portable `.exe` (Windows) and `.AppImage` (Linux) as release assets, create GitHub Release with tag = date.
        3. `build-firmware.yml`: on changes under `firmware/`, rebuild `.bin` in PlatformIO Docker, update `manifest.json` SHA256, commit to `firmware/dist/`.
        4. `README.md`: portable usage (download, run, no install); `docs/user-guide.md`: screenshots + flows.

**Open Questions**
1. Firmware fork location: vendor the patched telelogger into this repo under `firmware/` (recommended, self-contained) vs. git submodule pointing to a fork of `stanleyhuangyc/Freematics`? — assuming vendor-in-repo unless you object.
2. Windows code signing: skip (unsigned `.exe`, users get SmartScreen warning) vs. you provide an EV cert? — assuming skip for v1.
3. Auto-update of patched firmware `.bin`: app downloads latest from GitHub Releases on launch vs. bundles a fixed version? — assuming bundled + optional "check for updates".
4. Frontend framework: vanilla TS + Vite (lightest, recommended) vs. Svelte/SolidJS? — assuming vanilla TS unless you want a framework.
5. Live data polling rate: 1 Hz (safe) vs. configurable up to 5 Hz? — assuming 1 Hz default with a setting.
