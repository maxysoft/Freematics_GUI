## Phase 3 Complete: Serial command protocol

AT-style text protocol client over the SerialPortOps trait. Handles legacy APN/SSID/WPWD commands plus new CFG_DUMP/CFG_SAVE and live-data queries. 28-field DeviceConfig with full research defaults, dump/set round-trip parsing.

**Files created/changed:**
- src-tauri/src/protocol/mod.rs, types.rs, commands.rs, client.rs
- src-tauri/src/commands.rs (get_config, set_config, get_live_data)
- src-tauri/src/main.rs (mod protocol + registered commands)

**Functions created/changed:**
- SerialClient::send/query/set/dump_config/save_config/get_live_data
- DeviceConfig::from_dump_lines/to_set_commands, Default
- LiveData struct
- Tauri commands: get_config, set_config, get_live_data

**Tests created/changed:**
- 17 new protocol tests (types, commands, client) — all pass

**Review Status:** APPROVED (31/31 tests pass in Docker)

**Git Commit Message:**
```
feat: implement serial command protocol client

- AT-style protocol over SerialPortOps trait, 2s timeout
- DeviceConfig with 28 fields + research defaults
- CFG_DUMP/CFG_SAVE + live data (BATT/RSSI/GPS/VIN)
- Tauri commands get_config/set_config/get_live_data
- 17 new unit tests, all passing
```
