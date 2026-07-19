# Freematics Config Manager

A cross-platform **portable** desktop app for configuring, backing up, and flashing the [Freematics ONE+](https://freematics.com/) telematics device over USB. No installer required — download and run.

Built with [Tauri 2](https://tauri.app/) (Rust backend + vanilla TypeScript frontend) and a patched [PlatformIO](https://platformio.org/) firmware build.

> 🤖 **Made using AI.** This project was developed with AI assistance.
> ⚠️ **Personal use / experimental.** This software is built for personal use and may be unstable. Use at your own risk.

## Features

- **USB autodetect** — automatically detects the Freematics ONE+ (CH341, VID `1a86` / PID `7523`) on Windows (`COM*`) and Linux (`/dev/ttyUSB*`).
- **Full config management** — read and write the complete device parameter set over an AT-style serial protocol: cellular APN, Wi-Fi, server endpoint, GNSS mode, storage, OBD/MEMS/BLE/HTTP toggles, SIM PIN, motion threshold, intervals, and more. Every parameter has an inline **“i” description** explaining what it does.
- **Everything applies at runtime** — the patched firmware compiles all features in and selects them from the stored config at boot; changing any option is Apply → *Restart device* (one click), never a reflash. See [runtime configuration](#every-option-is-runtime-configurable--no-reflash-needed).
- **First-run “Set up device”** — a brand-new device with no readable config can be configured using *only* this app: it flashes the patched firmware, then opens the configurator. No esptool, Python, or any other tool required.
- **Native ESP32 flashing** — firmware is written with the [`espflash`](https://crates.io/crates/espflash) library compiled into the app (no `esptool.py`/Python). The patched `telelogger.bin` is bundled inside the app, so flashing works fully offline; a user-supplied `.bin` can also be chosen in the flash wizard.
- **Backup & restore** — export the live config to a versioned JSON file (with the firmware SHA256 stamped in) and re-import it onto the same or another device. You choose the backup location via a native file dialog.
- **Live telemetry** — battery voltage, RSSI, VIN, GPS fix, network operator/IP — **when the device is actively running** (see [Live data & device sleep](#live-data--device-sleep-behavior)).
- **Portable-only release** — Windows `.exe` and Linux `.AppImage`, no NSIS/MSI/DEB installers.

## Tech stack

| Layer        | Technology                                            |
| ------------ | ----------------------------------------------------- |
| Desktop shell| Tauri 2                                               |
| Backend      | Rust (`serialport`, `nusb`, `tokio`, `serde`)         |
| Frontend     | Vanilla TypeScript + Vite (no UI framework)           |
| Firmware     | ESP32 / PlatformIO (patched Freematics `telelogger`)  |
| Build/CI     | Docker (dev), GitHub Actions (release + firmware)     |

## Project structure

```
.
├── src/                     # Frontend (vanilla TS + Vite)
│   ├── components/          # form-field, gauge
│   ├── lib/                 # tauri bridge, events, state
│   └── views/               # connect, network, server, hardware, backup, flash-wizard, dashboard
├── src-tauri/               # Rust backend
│   ├── src/
│   │   ├── commands.rs      # Tauri command handlers
│   │   ├── usb/             # CH341 detection + serial port
│   │   ├── protocol/        # AT-style serial protocol client + config types
│   │   ├── flash/           # native espflash flasher (native.rs); esptool.rs is legacy
│   │   └── backup/          # JSON export/import
│   ├── tests/               # project_layout + e2e smoke tests
│   └── tauri.conf.json      # portable bundle config (resources = firmware/dist)
├── firmware/                # Patched firmware build
│   ├── overlay/             # configstore + serial_handler sources
│   ├── dist/                # bundled .bin + manifest.json (committed)
│   ├── build.sh             # PlatformIO build script (runs in Docker)
│   └── copy_artifact.sh     # copies .bin → dist/ + updates manifest SHA256
├── .github/workflows/       # release.yml (portable build) + build-firmware.yml
├── docs/user-guide.md       # End-user guide
├── Dockerfile               # Dev container (Rust + Node + Linux build deps)
└── docker-compose.yml       # dev + firmware services
```

## Development

All development runs inside Docker — no host installs required.

```bash
# Build the dev image once
docker compose build

# Interactive shell
docker compose run --rm dev bash

# Inside the container (or via one-shot commands):
npm ci
npm run build          # frontend (Vite)
npm test               # frontend unit tests (Vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # Rust unit + integration tests
cargo tauri build      # full portable build (Linux AppImage in dev container)
```

One-shot equivalents:

```bash
docker compose run --rm dev npm ci
docker compose run --rm dev npm test
docker compose run --rm dev cargo test --manifest-path src-tauri/Cargo.toml
```

### Firmware rebuild (dev)

The patched firmware is built in the `firmware` service container:

```bash
docker compose run --rm firmware bash build.sh
docker compose run --rm firmware bash copy_artifact.sh
```

This produces `firmware/dist/telelogger-patched.bin` and updates `firmware/dist/manifest.json` with a fresh SHA256. Commit the updated `dist/` files so they bundle into the next release.

## Building a portable release

### Option A — GitHub Actions (recommended)

Push to the `release` branch. The [`release`](.github/workflows/release.yml) workflow builds portable binaries on `ubuntu-latest` + `windows-latest`, verifies no installer artifacts are produced, and publishes a GitHub Release:

- **Windows:** standalone `freematics-config-manager.exe` — download and double-click, no install.
- **Linux:** `.AppImage` — download, `chmod +x`, run, no install.

### Option B — Local build (Linux)

```bash
docker compose run --rm dev cargo tauri build
# Output: src-tauri/target/release/freematics-config-manager
#         src-tauri/target/release/bundle/appimage/*.AppImage
```

## Downloading releases

Grab the latest portable build from the [Releases](../../releases) page:

1. Pick the asset for your OS.
2. **Windows:** download `freematics-config-manager.exe`, double-click to run.
3. **Linux:** download the `.AppImage`, then:
   ```bash
   chmod +x Freematics-Config-Manager_*.AppImage
   ./Freematics-Config-Manager_*.AppImage
   ```

No installation step. The firmware `.bin` is bundled inside the app, so flashing works without an internet connection.

### Linux virtual machine note

The app uses WebKit2GTK, which requires EGL with a DRI render node (`/dev/dri/renderD128`). On a **physical machine** with a working GPU driver this works out of the box. In a **virtual machine**, you must enable 3D acceleration so the hypervisor exposes a render node:

- **VirtualBox:** Settings → Display → Graphics Controller = VMSVGA, check Enable 3D Acceleration. If the VM then hangs on the boot splash, disable Plymouth (`plymouth.enable=0` on the kernel command line) — Plymouth deadlocks with VMSVGA 3D. See the [user guide troubleshooting section](docs/user-guide.md#virtual-machine-setup) for full steps.
- **VMware:** enable Accelerate 3D graphics in VM settings.
- **QEMU/KVM:** use `virtio-vga-gl` with `virglrenderer`.

Verify with `ls /dev/dri/` — you should see both `card0` and `renderD128`.

## Firmware patch explanation

The stock Freematics `telelogger` firmware exposes config only over BLE. This project ships a **patched** build that adds a serial command handler (`processSerial()`) mirroring the BLE protocol, plus an extended NVS-backed `Config` store covering every parameter the GUI can edit. New commands:

| Command      | Purpose                                  | Response |
| ------------ | ---------------------------------------- | -------- |
| `CFG_DUMP`   | Dump the entire config as `key=val` lines| `key=val` lines + `OK` |
| `CFG=key=val`| Set a single key                         | `OK` / `ERR` |
| `CFG_SAVE`   | Persist current config to NVS            | `OK` |
| `CFG_LOAD`   | Reload config from NVS                   | `OK` |
| `APN?` / `SSID?` / `WPWD?` | Legacy single-key query    | current value |
| `REBOOT`     | Restart the device (applies saved config) | `OK`, then resets |
| `BATT` `RSSI` `VIN` `LAT` `LNG` `ALT` `SAT` `SPD` `CRS` `UPTIME` `NET_OP` `NET_IP` | Live telemetry queries | value or `N/A` |

The overlay sources live in [`firmware/overlay/`](firmware/overlay/); `build.sh` clones the upstream Freematics repo, copies the overlay into `firmware_v5/telelogger/`, patches `telelogger.ino` to call `processSerial(cfg)`, and builds with PlatformIO. See [`firmware/README.md`](firmware/README.md) for the patch internals and [`docs/user-guide.md`](docs/user-guide.md) for the end-user walkthrough.

### Every option is runtime-configurable — no reflash needed

The stock telelogger fixes its behavior at compile time (`#define`s in `config.h`): protocol, storage, GNSS mode, and every feature toggle required editing the source and reflashing. The patched firmware removes that limitation: **all features are compiled in** (OBD, MEMS, BLE, HTTP server, WiFi, SD + SPIFFS, UDP + HTTPS) and the stored config **selects and tunes them at boot**. Changing any setting in the app is: Apply → **Restart device** (a button in the app — the firmware has a serial `REBOOT` command) → new behavior. Reflashing is only ever needed for firmware upgrades.

Runtime-applied settings (everything the app shows): cellular APN + auth + SIM PIN, WiFi SSID/password, server host/port/protocol/path, GNSS mode + always-on + reset timeout, storage backend (SD/SPIFFS/none), OBD/MEMS/BLE/HTTP-server enables, WiFi soft-AP name/password, sync & ping-back intervals, motion threshold, jump-start voltage, cool-down temp, max OBD errors. The only read-only field is the PSRAM flag (a hardware fact).

Under the hood, this required making the upstream firmware's compile-time choices runtime-selectable: the UDP/HTTPS client and SD/SPIFFS logger are instantiated through base-class pointers chosen at boot, feature `#if` blocks gained runtime guards (with careful handling of the standby/wake logic and BLE/HTTPD loop pacing), and `SERVER_*` macros became variables fed from the config store. The patched firmware also services the config serial link **while sleeping**, so a configurator connecting to a parked device wakes it instead of requiring a power-cycle. Live queries never call blocking modem commands — `NET_IP` reports the IP cached at connection time.

## Serial communication & reliability

The single most important thing to understand: **the patched firmware shares one UART between the telemetry logger and this config protocol.** While running, the firmware continuously prints its own async output (`[BUF] N samples …`, `[CELL] …`, GPS lines, boot/SD banners) and blocks for seconds on cellular/OBD/upload work. Naïvely reading "the next line" after sending a command therefore returns *telemetry chatter*, not the reply. Reliable config required fixes on **both** sides:

**App side (`src-tauri/src/protocol/client.rs`):**

- **Drain before send** — clears any buffered chatter so a stale line can't be mistaken for the reply.
- **Read past chatter** — for commands that must be acknowledged (`set`, `save`), the client reads lines until it finds a definitive `OK`/`ERR`, skipping anything else, up to an 8 s per-attempt deadline, and **retries** (3×) to ride over a busy telemetry/cellular cycle. An explicit `ERR` is final; only silence is retried.
- **Tolerant config dump** — `CFG_DUMP` is retried a few times (the CH340 auto-reset can reboot the ESP32 on port open) and only well-formed `key=value` lines are kept, so interleaved chatter is ignored.

**Firmware side (`firmware/overlay/serial_handler.cpp` + `build.sh` `loop()` guards):**

- **Backlog drain** — `processSerial()` consumes **all** queued command lines each `loop()`, not one — so a config command can't get stuck for minutes behind a backlog of live-poll queries the busy logger serviced one-per-iteration.
- **Config window (`fcmInConfig`)** — a `CFG_*`/`CFG=` command opens an ~8 s window during which `loop()` skips the telemetry/upload work, so the line goes quiet and replies are prompt. Live queries do **not** open it, so telemetry keeps flowing during live polling.
- **Keep-awake (`fcmAwake`)** — see below.

## Live data & device sleep behavior

The Freematics ONE+ is a vehicle tracker: when it sees no OBD link and no motion (e.g. on a bench), its `standby()` routine deliberately **sleeps until the device is physically moved** (`waitMotion(-1)`) or jump-start voltage appears. That would make the serial port go dead mid-configuration.

To prevent that, **any** serial command refreshes a 60 s *keep-awake* window (`fcmAwake`); while it is active `loop()` skips `standby()`, so a connected configurator keeps the device alive and responsive. The desktop app sends a lightweight heartbeat (every ~20 s on config tabs; the live tab's 3 s poll covers itself) so the window never lapses during a session. When you disconnect, the window lapses after ~60 s and the device resumes normal tracker sleep.

**Consequence — live data on a bench is limited.** While the device is held awake-and-quiet for configuration, its telemetry loop is paused, so `BATT`/`GPS`/`RSSI` typically read `N/A` (no OBD power, no indoor GPS fix); `UPTIME`, operator and IP still show. This is the inherent tension of a shared UART: a device can either *run* (full live telemetry, but it sleeps when parked) or be *held awake and quiet for config* — not robustly both at once. **This app prioritizes reliable configuration.** Empty live fields render as `0` or `—`, not an error.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `serial RX failed … BATT: no response` while idle | Normal — no OBD link means no battery reading. Harmless; logged at debug. |
| Live data shows `0` / `—` / `N/A` on a bench | Expected — telemetry is paused while the device is kept awake for config, and there's no OBD/GPS on a desk. See [above](#live-data--device-sleep-behavior). |
| Device stops responding after ~30 s | The device went into `standby()` (sleep). The current firmware keeps a connected configurator awake, and even a **sleeping** device now services the config serial link (a serial command wakes it) — flash the bundled firmware if yours predates this. |
| `Apply` fails with "no response" / "unexpected response: …" | You are on firmware **older** than the reliability fixes. Rebuild the firmware (CI or `firmware/build.sh`), reflash via the app, and retry. |
| `Apply` succeeds but the setting didn't change | Settings take effect on the **next restart** — use the **Restart device now** button that appears after Apply (or power-cycle). Requires the runtime-config firmware (flash the bundled `.bin` once via the app). |
| `Apply` fails with `invalid type: string … expected i32` | Fixed — number fields are now coerced before sending. Update the app. |
| `wifi_ssid` required even with Wi-Fi off | Fixed — SSID/password are only validated when *Enable Wi-Fi (station)* is checked. |
| Flash screen flickers during progress | Fixed — the progress bar updates in place. |
| Where are the debug logs? | The app uses `tauri-plugin-log`. On Windows: `%APPDATA%\com.maxynetwork.freematics-config-manager\logs\`; on Linux: `~/.local/share/com.maxynetwork.freematics-config-manager/logs/` (file name `freematics-config-manager`). Secrets (Wi-Fi/APN passwords, SIM PIN) are redacted. |

> **Firmware changes require a rebuild + reflash.** App-side fixes ship in the app, but the backlog-drain, config-window, keep-awake, and live-data wiring all live in the firmware. After changing anything under `firmware/overlay/` or `firmware/build.sh`, rebuild the `.bin` (CI `build-firmware.yml` or `firmware/build.sh`), commit `firmware/dist/`, build the app, and flash the device once more.

## License

See the upstream [Freematics](https://github.com/stanleyhuangyc/Freematics) repository for firmware licensing. Application code in this repo is provided as-is.
