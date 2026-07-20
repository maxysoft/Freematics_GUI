# Patched Freematics Telelogger Firmware

> ⚠️ **Personal use / experimental.** This firmware patch is built for personal use and may be unstable. Use at your own risk.

This directory builds a **patched** version of the Freematics `firmware_v5/telelogger`
firmware that adds a serial command handler (`processSerial`) mirroring the existing
`processBLE()`, extends NVS storage to **all 28 config parameters**, adds the
`CFG_DUMP` / `CFG_LOAD` / `CFG_SAVE` / `CFG=key=val` / `REBOOT` commands, and makes
**every parameter take effect at runtime** — all features are compiled in and
selected/tuned from the stored config at boot (see
[What the config changes](#what-the-config-changes)).

Beyond the config protocol the patch also adds: a **config window** (`fcmInConfig`)
that quiets the shared UART while a config command is in flight, a **keep-awake
window** (`fcmAwake`) so a connected configurator can't drop into `standby()` — and
the standby wait loops themselves service the serial link, so a serial command
**wakes a sleeping device** — and a **live-telemetry hook** (`fcmLiveQuery`) backing
`BATT`/`RSSI`/`GPS`/`NET_*` queries without blocking modem calls.

## Approach (vendored patched sources)

The overlay carries **fully patched copies** of the five upstream files we modify;
`build.sh` clones upstream at a **pinned commit** (for the libraries and build
system), copies the overlay over it, and builds. With the amount of runtime-config
surgery involved, vendored files are the only maintainable form — the earlier
`sed`/`awk` patching approach was retired. Bumping the pinned ref means re-deriving
the vendored files against the new upstream.

1. `firmware/Dockerfile` — base `python:3.11-slim`, installs PlatformIO + git.
2. `firmware/overlay/` — our additions:
   - `configstore.h` / `configstore.cpp` — `Config` struct (28 fields, mirrors
     `src-tauri/src/protocol/types.rs` `DeviceConfig`) with `load()` / `save()` /
     `dump()` over NVS namespace `"cfg"`.
   - `serial_handler.h` / `serial_handler.cpp` — `processSerial(Config&)` command
     dispatcher (config protocol, live queries, `REBOOT`, config/keep-awake windows).

   …and the vendored patched upstream files:
   - `telelogger.ino` — runtime selection globals (`fcm*`), pointer-based
     client/logger, runtime feature gates, standby/wake restructure,
     `fcmApplyConfig()` + `fcmLiveQuery()`.
   - `teleclient.h` — base-class virtuals (`connect(bool)`, `ping`, `shutdown`,
     `cellClient()`/`wifiClient()` accessors) so UDP vs HTTPS is a runtime choice.
   - `teleclient.cpp` — `SERVER_HOST/PORT/PATH` macros → runtime variables; fixes
     the upstream HTTPS-GET branch (wrote to an undeclared buffer) and makes
     GET vs POST a runtime flag.
   - `telestore.h` — virtual `begin()` on `FileLogger` so SD/SPIFFS/none is a
     runtime choice through a base pointer.
   - `dataserver.cpp` — runtime storage branches, config-driven soft-AP
     credentials, and a started-flag so `serverProcess()` degrades to `delay()`
     when the HTTP server is off.
3. `firmware/build.sh` — clone at pinned ref → copy overlay → append build flags
   (`ENABLE_OBD/MEMS/BLE/HTTPD=1`, `STORAGE=2`, `GNSS=1`; all runtime-gated) →
   host-side `g++` unit tests → `pio run -e esp32dev`.
4. `firmware/test/` — host-side unit tests with mock NVS + mock Serial, plus
   `device_smoke.py`, an on-device protocol test (set/save/`REBOOT`/verify over
   the real serial port; see `docker-compose.device.yml` at the repo root).
5. `firmware/copy_artifact.sh` — copies the built `.bin` into `firmware/dist/` and
   refreshes `manifest.json` (SHA256, commit, date). The app bundles that `.bin`.

## Config keys (28)

`apn`, `ssid`, `wpwd`, `srv_host`, `srv_port`, `srv_proto`, `srv_path`, `gnss`,
`storage`, `obd`, `mems`, `wifi`, `ble`, `httpd`, `sim_pin`, `apn_user`, `apn_pass`,
`ap_ssid`, `ap_pwd`, `motion_thr`, `jumpstart_v`, `cooling_t`, `gnss_always`,
`gnss_reset_t`, `max_obd_err`, `srv_sync_int`, `pingback_int`, `psram`.

Defaults match `DeviceConfig::default()` in `src-tauri/src/protocol/types.rs`.

## What the config changes

**Every key except `psram` takes effect at runtime**, applied once at boot by
`cfg.load()` + `fcmApplyConfig(cfg)` in `setup()`. Change → `CFG_SAVE` → `REBOOT`
(the app's *Restart device* button) and the new behavior is live:

- **Credentials:** `apn`, `apn_user`, `apn_pass`, `sim_pin`, `ssid`, `wpwd`
  (a non-empty `ssid` makes the device join WiFi).
- **Server endpoint:** `srv_host`, `srv_port` (0 = protocol default),
  `srv_proto` (selects the UDP or HTTPS client at boot; `https_get` vs
  `https_post` switches the HTTP method), `srv_path`.
- **Feature toggles:** `obd`, `mems`, `ble`, `httpd` (with `ap_ssid`/`ap_pwd`
  for its soft-AP), `gnss` (none/standalone/cellular), `gnss_always`,
  `storage` (none/spiffs/sd).
- **Tunables (0 = keep firmware default):** `motion_thr`, `jumpstart_v` (mV→V),
  `cooling_t`, `gnss_reset_t`, `max_obd_err`, `srv_sync_int`.
- **`pingback_int`:** 0 = ping-backs **disabled** (matches the app's docs), any
  other value = seconds between standby pings.
- **Hardware fact (read-only):** `psram`.

Strings override only when non-empty and numerics only when > 0, so an unset or
corrupted store can never brick the device — it falls back to compile-time
defaults. The MEMS/OBD wake strategy in `standby()` follows the toggles
(MEMS motion-wake → OBD jump-start voltage → 5 s poll), and the standby wait
loops service the serial link so a configurator wakes a sleeping device.

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
| `REBOOT` | `OK`, then the device restarts (applies saved config) |
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

Pinned to commit `9b0a68d` (the tree the vendored overlay files were derived
from). Overridable via the `FREEMATICS_REF` env var, but bumping it requires
re-deriving the vendored `telelogger.ino` / `teleclient.*` / `telestore.h` /
`dataserver.cpp` against the new upstream:

```bash
docker compose run --rm -e FREEMATICS_REF=<commit-sha> firmware bash build.sh
```
