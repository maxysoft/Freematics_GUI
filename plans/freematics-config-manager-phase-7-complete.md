## Phase 7 Complete: Frontend UI (device dashboard + config forms)

Vanilla TS + Vite frontend with custom elements (gauge, form-field), 5 tabbed views (Live Data, Network, Server, Hardware, Backup), connect screen with autodetect polling, dark theme, accessibility (role=meter, aria-invalid, labels). Tauri v2 withGlobalTauri.

**Files created/changed:**
- src-tauri/tauri.conf.json (withGlobalTauri: true)
- src/lib/tauri.ts, src/lib/state.ts
- src/components/gauge.ts, form-field.ts
- src/views/connect.ts, dashboard.ts, network.ts, server.ts, hardware.ts, backup.ts
- src/main.ts, src/styles.css, index.html

**Functions created/changed:**
- Tauri invoke wrappers (9 commands)
- AppState store
- <fm-gauge>, <fm-field> custom elements
- ConnectView, DashboardView, NetworkView, ServerView, HardwareView, BackupView

**Tests created/changed:**
- 35 frontend tests (tauri, gauge, form-field, connect, network, backup, main) — all pass

**Review Status:** APPROVED (35/35 tests, vite build OK)

**Git Commit Message:**
```
feat: user-friendly frontend UI with tabbed dashboard

- Vanilla TS + Vite, custom elements (gauge, form-field)
- Connect screen with USB autodetect polling
- 5 tabs: Live Data, Network, Server, Hardware, Backup
- Dark theme, accessible (ARIA meter/invalid, labels)
- 35 frontend tests passing, vite build 25KB JS
```
