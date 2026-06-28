## Phase 9 Complete: Packaging + GitHub Actions release (portable)

Portable-only packaging (Windows .exe, Linux .AppImage — no installers), firmware bundled as Tauri resources, GitHub Actions release workflow on `release` branch with verify-portable step, firmware rebuild workflow, README + user guide.

**Files created/changed:**
- src-tauri/tauri.conf.json (bundle.resources, portable targets)
- src-tauri/src/commands.rs (AppHandle resource path resolution)
- .github/workflows/release.yml (finalized, verify-portable, release job)
- .github/workflows/build-firmware.yml (new)
- README.md (rewritten)
- docs/user-guide.md (new)
- src-tauri/tests/e2e.rs (5 smoke tests)

**Functions created/changed:**
- firmware_dist_dir (resource resolution with dev fallback)
- get_firmware_info, flash_firmware_cmd, export_config_cmd, import_config_cmd (AppHandle)

**Tests created/changed:**
- e2e.rs: 5 tests (portable targets, resources declared, dist files exist, manifest valid, release workflow)

**Review Status:** APPROVED (112/112 tests pass: 59 Rust + 53 TS)

**Git Commit Message:**
```
feat: portable packaging + GitHub Actions release

- Bundle firmware as Tauri resources (offline flash)
- Resource path resolution via AppHandle + dev fallback
- release.yml: portable .exe + .AppImage, verify-portable step
- build-firmware.yml: auto-rebuild firmware on firmware/ changes
- README + user guide for non-programmers
- 5 e2e smoke tests, all passing
```
