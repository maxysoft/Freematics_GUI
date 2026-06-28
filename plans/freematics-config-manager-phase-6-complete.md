## Phase 6 Complete: Backup/restore (JSON + firmware hash)

Versioned BackupFile (schema v1) with full DeviceConfig + firmware SHA256 + export timestamp. Export dumps live config; import applies all 28 CFG= commands + CFG_SAVE, warns (not errors) on firmware hash mismatch.

**Files created/changed:**
- src-tauri/src/backup/mod.rs, schema.rs, export.rs, import.rs
- src-tauri/src/commands.rs (export_config_cmd, import_config_cmd)
- src-tauri/src/main.rs (mod backup + registered commands)
- src-tauri/src/protocol/client.rs (test accessors)
- src-tauri/Cargo.toml (chrono)

**Functions created/changed:**
- BackupFile::new, export_to_json, export_config, write_backup_file
- ImportOutcome (Success/SuccessWithWarnings), parse_backup_json, import_config, read_backup_file
- export_config_cmd, import_config_cmd (Tauri commands)

**Tests created/changed:**
- 16 backup tests (schema, export, import, round-trip, warnings)

**Review Status:** APPROVED (54/54 tests pass)

**Git Commit Message:**
```
feat: backup/restore config as versioned JSON

- BackupFile schema v1 with DeviceConfig + firmware SHA256
- Export dumps live config, import applies CFG= + CFG_SAVE
- Firmware hash mismatch = warning, not error
- export_config_cmd + import_config_cmd Tauri commands
- 16 new unit tests, all passing
```
