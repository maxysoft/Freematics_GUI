## Phase 1 Complete: Project scaffolding + Docker dev env

Bootstrapped Tauri 2.x (Rust + vanilla TS/Vite) project with Docker-only dev environment and GitHub Actions release workflow producing portable Windows `.exe` and Linux `.AppImage` (no installers).

**Files created/changed:**
- Dockerfile, docker-compose.yml, .dockerignore
- src-tauri/Cargo.toml, src-tauri/tauri.conf.json, src-tauri/src/main.rs, src-tauri/build.rs, src-tauri/icons/icon.png, src-tauri/capabilities/default.json
- package.json, package-lock.json, tsconfig.json, vite.config.ts, index.html
- src/main.ts, src/styles.css, src/main.test.ts
- src-tauri/tests/project_layout.rs
- .github/workflows/release.yml
- AGENTS.md, README.md, .gitignore

**Functions created/changed:**
- `main()` — Tauri app entrypoint
- `greet()` — frontend placeholder export

**Tests created/changed:**
- src-tauri/tests/project_layout.rs (8 assertions)
- src/main.test.ts (2 tests)

**Review Status:** APPROVED

**Git Commit Message:**
```
chore: scaffold Tauri portable app with Docker dev env

- Tauri 2.x Rust + vanilla TS/Vite frontend
- Dockerfile + docker-compose for Docker-only dev
- GitHub Actions release workflow (portable .exe + .AppImage)
- Project layout + frontend unit tests
- AGENTS.md with plans/ dir, Docker-only, caveman ultra policies
```
