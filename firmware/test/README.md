# Host-side (native) tests

These run under PlatformIO's `native` platform — no ESP32 hardware required.

## What they test

- `configstore_test.cpp` — `Config::load()` returns defaults on empty NVS,
  `save()` → `load()` round-trips all 28 fields, `dump()` produces all 28
  `key=value` lines, `set()`/`get()` round-trip.
- `serial_handler_test.cpp` — `processSerial()` dispatch: `CFG_DUMP`, `CFG_SAVE`,
  `CFG_LOAD`, `CFG=key=val`, `APN?`/`APN=`, `SSID?`/`SSID=`, `WPWD?`/`WPWD=`,
  live-data queries (`N/A`), unknown (`ERROR`), empty line (no response).

## Mocks

- `mock_nvs.h` — backs `nvs_open`/`nvs_get_str`/`nvs_set_str`/`nvs_get_u8`/
  `nvs_set_u8`/`nvs_get_i16`/`nvs_set_i16` with `std::unordered_map`.
- `mock_serial.h` — `MockSerial` buffers input/output.
- `Arduino.h` — minimal `String` shim for native compilation.

## Run

```bash
docker compose run --rm firmware pio test -e native
```

Or directly inside the container:

```bash
cd /firmware/repo && pio test -e native
```
