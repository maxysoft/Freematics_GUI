# Patched Freematics Telelogger Firmware

> ⚠️ **Personal use / experimental.** This firmware patch is built for personal use and may be unstable. Use at your own risk.

This directory builds a **patched** version of the Freematics `firmware_v5/telelogger`
firmware that adds a serial command handler (`processSerial`) mirroring the existing
`processBLE()`, extends NVS storage to **all 28 config parameters**, adds the
`CFG_DUMP` / `CFG_LOAD` / `CFG_SAVE` / `CFG=key=val` commands, and wires a subset of
those parameters into actual runtime behavior (see [What the config changes](#what-the-config-changes)).

Beyond the config protocol the patch also adds: a **config window** (`fcmInConfig`)
that quiets the shared UART while a config command is in flight, a **keep-awake
window** (`fcmAwake`) so a connected configurator can't drop into `standby()`, and a
**live-telemetry hook** (`fcmLiveQuery`) backing `BATT`/`RSSI`/`GPS`/`NET_*` queries.

## Approach (no vendoring)

We do **not** vendor the entire Freematics repository. Instead:

1. `firmware/Dockerfile` — base `python:3.11-slim`, installs PlatformIO + git.
2. `firmware/overlay/` — our patch files:
   - `configstore.h` / `configstore.cpp` — `Config` struct (28 fields, mirrors
     `src-tauri/src/protocol/types.rs` `DeviceConfig`) with `load()` / `save()` /
     `dump()` over NVS namespace `"cfg"`.
   - `serial_handler.h` / `serial_handler.cpp` — `processSerial(Config&)` command
     dispatcher.
   - `platformio.ini` — PlatformIO config with `native` (host tests) and `esp32dev`
     (firmware) environments.
3. `firmware/build.sh` — clones the Freematics repo at a pinned ref, copies overlay
   files into `firmware_v5/telelogger/`, `awk`/`sed`-patches `telelogger.ino`
   (include + `processSerial(cfg)` in `loop()`, the config-window / keep-awake
   guards, the `fcmLiveQuery` and `fcmApplyConfig` hooks, and the macro→override
   rewrites), then runs the host-side `g++` unit tests and `pio run -e esp32dev`.
   All `awk`/`sed` patches are **idempotent** (guarded by a `grep` first).
4. `firmware/test/` — host-side unit tests with mock NVS + mock Serial, compiled
   directly with `g++` by `build.sh`.
5. `firmware/copy_artifact.sh` — copies the built `.bin` into `firmware/dist/` and
   refreshes `manifest.json` (SHA256, commit, date). The app bundles that `.bin`.

## Config keys (28)

`apn`, `ssid`, `wpwd`, `srv_host`, `srv_port`, `srv_proto`, `srv_path`, `gnss`,
`storage`, `obd`, `mems`, `wifi`, `ble`, `httpd`, `sim_pin`, `apn_user`, `apn_pass`,
`ap_ssid`, `ap_pwd`, `motion_thr`, `jumpstart_v`, `cooling_t`, `gnss_always`,
`gnss_reset_t`, `max_obd_err`, `srv_sync_int`, `pingback_int`, `psram`.

Defaults match `DeviceConfig::default()` in `src-tauri/src/protocol/types.rs`.

## What the config changes

The store persists all 28 keys, but the stock telelogger drives behavior from
compile-time `#define`s. At boot `build.sh` injects `cfg.load()` + `fcmApplyConfig(cfg)`,
which pushes a subset of the store into the firmware's live globals/overrides, so
those settings take effect **on the next reboot**:

- **Applied at runtime:** `apn`, `apn_user`, `apn_pass`, `sim_pin`, `ssid`, `wpwd`,
  `srv_sync_int`, `pingback_int`, `motion_thr`, `jumpstart_v` (mV→V), `cooling_t`,
  `gnss_reset_t`, `max_obd_err`.
- **Compile-time only** (stored/dumped but not applied; the GUI shows these
  read-only): `srv_host`, `srv_port`, `srv_proto`, `srv_path`, `gnss`, `storage`,
  `obd`, `mems`, `httpd`, `ble`, `gnss_always`, `psram`, `ap_ssid`, `ap_pwd`.

To make a compile-time field configurable you must edit `config.h` and rebuild.

## Serial protocol

All commands `\r` or `\n` terminated; all responses `\r\n` terminated.

| Command | Response |
|---|---|
| `CFG_DUMP` | all `key=value\n` lines + `OK` |
| `CFG_SAVE` | `OK` (persists to NVS) |
| `CFG_LOAD` | `OK` (reloads from NVS) |
| `CFG=key=val` | `OK` or `ERR` (unknown key / no `=`) |
| `APN?` / `SSID?` / `WPWD?` | current value |
| `APN=val` / `SSID=val` / `WPWD=val` | `OK` |
| `BATT` `RSSI` `VIN` `LAT` `LNG` `ALT` `SAT` `SPD` `CRS` `UPTIME` `NET_OP` `NET_IP` | live value, or `N/A` when not yet available |
| unknown | `ERROR` |

Live queries read the telelogger's own globals (`batteryVoltage`, `rssi`, `gd`,
`netop`, the connection-time `ip`, …). `NET_IP` returns the **cached** IP rather than
calling the modem's blocking `getIP()`, so a down modem can't stall the serial link.

## Build (Docker only)

```bash
# Build the firmware image
docker compose build firmware

# Build the ESP32 firmware (clones Freematics repo, runs g++ host tests, then
# pio run -e esp32dev). Needs network on first run for the repo + pio packages.
docker compose run --rm firmware bash build.sh

# Copy the built .bin into firmware/dist/ + refresh manifest.json
docker compose run --rm firmware bash copy_artifact.sh
```

Output `.bin`: `firmware/repo/firmware_v5/telelogger/.pio/build/esp32dev/firmware.bin`,
copied to `firmware/dist/telelogger-patched.bin` (committed + bundled).

## Flashing

The desktop app flashes natively via the [`espflash`](https://crates.io/crates/espflash)
library compiled into it (no `esptool.py`/Python). The patched `.bin` from
`firmware/dist/` is embedded in the app at build time (`include_bytes!`), so flashing
works fully offline — just use **⚡ Flash Firmware** in the app.

Manual flashing (optional, if you have `esptool.py` installed) targets offset
`0x10000`:

```bash
esptool.py --port /dev/ttyUSB0 --baud 921600 write_flash 0x10000 telelogger-patched.bin
```

## Pinned Freematics ref

Set via `FREEMATICS_REF` env var (default `master`). Pin to a specific commit for
reproducible builds:

```bash
docker compose run --rm -e FREEMATICS_REF=<commit-sha> firmware bash build.sh
```
