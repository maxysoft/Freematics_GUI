# Patched Freematics Telelogger Firmware (Phase 4)

This directory builds a **patched** version of the Freematics `firmware_v5/telelogger`
firmware that adds a serial command handler (`processSerial`) mirroring the existing
`processBLE()`, extends NVS storage to **all 28 config parameters**, and adds the
`CFG_DUMP` / `CFG_LOAD` / `CFG_SAVE` / `CFG=key=val` commands.

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
   files into `firmware_v5/telelogger/`, `sed`-patches `telelogger.ino` to
   `#include "serial_handler.h"` and call `processSerial(cfg)` from `loop()`, then
   runs `pio test -e native` and `pio run -e esp32dev`.
4. `firmware/test/` — host-side (native) unit tests with mock NVS + mock Serial.

## Config keys (28)

`apn`, `ssid`, `wpwd`, `srv_host`, `srv_port`, `srv_proto`, `srv_path`, `gnss`,
`storage`, `obd`, `mems`, `wifi`, `ble`, `httpd`, `sim_pin`, `apn_user`, `apn_pass`,
`ap_ssid`, `ap_pwd`, `motion_thr`, `jumpstart_v`, `cooling_t`, `gnss_always`,
`gnss_reset_t`, `max_obd_err`, `srv_sync_int`, `pingback_int`, `psram`.

Defaults match `DeviceConfig::default()` in `src-tauri/src/protocol/types.rs`.

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
| `BATT` `RSSI` `VIN` `LAT` `LNG` `ALT` `SAT` `SPD` `CRS` `UPTIME` `NET_OP` `NET_IP` | value or `N/A` |
| unknown | `ERROR` |

## Build (Docker only)

```bash
# Build the firmware image
docker compose build firmware

# Run host-side native tests (TDD requirement)
docker compose run --rm firmware pio test -e native

# Build the ESP32 firmware (clones Freematics repo, needs network)
docker compose run --rm firmware bash build.sh
```

Output `.bin`: `firmware/repo/.pio/build/esp32dev/firmware.bin`.

## Flashing

Flash with esptool (Phase 5 will integrate this into the app):

```bash
esptool.py --port /dev/ttyUSB0 --baud 921600 write_flash 0x10000 firmware.bin
```

## Pinned Freematics ref

Set via `FREEMATICS_REF` env var (default `master`). Pin to a specific commit for
reproducible builds:

```bash
docker compose run --rm -e FREEMATICS_REF=<commit-sha> firmware bash build.sh
```
