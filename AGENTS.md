# Agents

## Plan directory
`plans/` — multi-phase plan documents. Read the relevant plan before starting work.

## Environment policy
**Docker only.** Never install packages or run builds on the host.
- All Rust/Node work happens inside the `dev` container (`docker compose run --rm dev ...`).
- If Docker is unavailable, STOP and report — do not fall back to host installs.

## Communication
- Intermediate narration (tool calls, progress): caveman ultra — terse, no articles.
- Final summary: normal English, full sentences.

## Workflow
- TDD: write failing test first, then minimal code to pass, then verify in Docker.
- Run individual test file first, then full suite for regressions.
- Do not reset file changes without explicit instruction.

## Builds
- Portable only: Windows `.exe` (no installer), Linux `.AppImage`. No nsis/msi/deb.
