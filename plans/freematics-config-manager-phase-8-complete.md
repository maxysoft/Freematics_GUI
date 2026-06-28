## Phase 8 Complete: Live monitoring + firmware flash UI

Flash wizard (4-step modal: Warning → Backup → Flash → Restore) with progress bar bound to flash://progress events. Live data polling pauses during wizard, resumes on close. Typed Tauri event helpers with graceful no-Tauri fallback.

**Files created/changed:**
- src/lib/events.ts, src/lib/events.test.ts
- src/views/flash-wizard.ts, src/views/flash-wizard.test.ts
- src/lib/state.ts (flashWizardOpen, backupPath)
- src/views/dashboard.ts (Flash button, polling pause/resume)
- src/main.ts (wizard overlay rendering)
- src/styles.css (wizard modal, progress bar)

**Functions created/changed:**
- listenFlashProgress, listenLiveData, isFlashProgress, isLiveData, parseLiveDataEvent
- FlashWizardView (4-step state machine)
- AppState.openFlashWizard/closeFlashWizard

**Tests created/changed:**
- 18 new tests (events 10, flash-wizard 8)

**Review Status:** APPROVED (53/53 frontend tests, vite build OK)

**Git Commit Message:**
```
feat: firmware flash wizard + live event streaming

- 4-step modal: Warning, Backup, Flash, Restore
- Progress bar bound to flash://progress Tauri events
- Live polling pauses during wizard, resumes on close
- Typed event helpers with no-Tauri fallback
- 18 new frontend tests, all passing
```
