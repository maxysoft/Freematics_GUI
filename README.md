# Freematics Config Manager

A cross-platform **portable** desktop app for configuring, backing up, and flashing the [Freematics ONE+](https://freematics.com/) telematics device over USB. No installer required — download and run.

Built with [Tauri 2](https://tauri.app/) (Rust backend + vanilla TypeScript frontend) and a patched [PlatformIO](https://platformio.org/) firmware build.

## Features

- **USB autodetect** — automatically detects the Freematics ONE+ (CH341, VID `1a86` / PID `7523`) on Windows (`COM*`) and Linux (`/dev/ttyUSB*`).
- **Full config management** — read and write the complete device parameter set over an AT-style serial protocol: cellular APN, Wi-Fi, server endpoint, GNSS mode, storage, OBD/MEMS toggles, SIM PIN, motion threshold, intervals, and more.
- **Backup & restore** — export the live config to a versioned JSON file (with the firmware SHA256 stamped in) and re-import it onto the same or another device.
- **One-click firmware flash** — reflashes a patched `telelogger` firmware that exposes the serial command protocol, bundled inside the app so flashing works fully offline.
- **Live telemetry** — battery voltage, RSSI, VIN, GPS fix, network operator/IP.
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
│   │   ├── flash/           # esptool integration
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

| Command      | Purpose                                  |
| ------------ | ---------------------------------------- |
| `CFG?`       | Dump a single key                        |
| `CFG=key=val`| Set a single key                         |
| `CFG_DUMP`   | Dump the entire config as `key=val` lines|
| `CFG_LOAD`   | Reload config from NVS                   |
| `CFG_SAVE`   | Persist current config to NVS            |
| `BATT`/`RSSI`/`VIN`/`LAT`/`LNG`/... | Live telemetry queries     |

The overlay sources live in [`firmware/overlay/`](firmware/overlay/); `build.sh` clones the upstream Freematics repo, copies the overlay into `firmware_v5/telelogger/`, patches `telelogger.ino` to call `processSerial(cfg)`, and builds with PlatformIO. See [`docs/user-guide.md`](docs/user-guide.md) for the end-user walkthrough.

## License

See the upstream [Freematics](https://github.com/stanleyhuangyc/Freematics) repository for firmware licensing. Application code in this repo is provided as-is.
