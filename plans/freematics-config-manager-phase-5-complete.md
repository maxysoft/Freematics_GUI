## Phase 5 Complete: Firmware flash command (esptool)

One-click firmware flash via mockable FlashRunner trait + CommandFlashRunner (shells out to esptool.py). SHA256 verification before flash, progress events parsed from esptool stderr, emitted as `flash://progress` Tauri events. Real firmware.bin (1.62MB) + manifest.json with SHA256 populated.

**Files created/changed:**
- src-tauri/src/flash/mod.rs, esptool.rs
- src-tauri/src/commands.rs (FirmwareInfo, FlashProgressEvent, get_firmware_info, flash_firmware_cmd)
- src-tauri/src/main.rs (mod flash + registered commands)
- src-tauri/Cargo.toml (sha2, hex)
- firmware/dist/manifest.json, copy_artifact.sh

**Functions created/changed:**
- FlashRunner trait, CommandFlashRunner
- build_cli_args, compute_sha256, verify_sha256, FlashProgress
- flash_firmware_with, flash_firmware
- get_firmware_info, flash_firmware_cmd (Tauri commands)

**Tests created/changed:**
- 6 flash tests (cli args, sha256 verify, progress parse, success, sha mismatch, runner error)

**Review Status:** APPROVED (37/37 tests pass, manifest populated)

**Git Commit Message:**
```
feat: one-click firmware flash with sha256 verification

- FlashRunner trait + CommandFlashRunner (esptool.py subprocess)
- SHA256 verify before flash, progress events to frontend
- get_firmware_info + flash_firmware_cmd Tauri commands
- Real firmware.bin + manifest.json with SHA256
- 6 new unit tests, all passing
```
