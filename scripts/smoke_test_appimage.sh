#!/usr/bin/env bash
# Post-build smoke test: launch the AppImage headless via Xvfb, verify it stays
# alive (didn't crash on startup), then kill it. Run inside the dev container.
set -euo pipefail

APPIMAGE="${1:-/workspace/dist/freematics-config-manager-linux.AppImage}"

if [ ! -f "$APPIMAGE" ]; then
    echo "FAIL: AppImage not found at $APPIMAGE" >&2
    exit 1
fi

# Xvfb provides a virtual X server (no GPU needed) for headless testing.
if ! command -v Xvfb >/dev/null 2>&1; then
    echo "Xvfb not installed — skipping smoke test (install with: apt-get install -y xvfb)" >&2
    exit 0
fi

export DISPLAY=:99
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export LIBGL_ALWAYS_SOFTWARE=1
export GDK_BACKEND=x11

Xvfb :99 -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!
cleanup() { kill "$XVFB_PID" 2>/dev/null || true; }
trap cleanup EXIT

# Give Xvfb a moment to start.
sleep 1

# Launch the app in the background, capture its PID.
# --appimage-extract-and-run avoids the FUSE requirement (needed in containers/VMs).
"$APPIMAGE" --appimage-extract-and-run >/tmp/app.log 2>&1 &
APP_PID=$!

# Wait up to 8 seconds; if the process is still alive, the app launched OK.
for i in $(seq 1 8); do
    if ! kill -0 "$APP_PID" 2>/dev/null; then
        echo "FAIL: app exited early (after ${i}s). Log:" >&2
        cat /tmp/app.log >&2
        exit 1
    fi
    sleep 1
done

# Success — kill the app cleanly.
kill "$APP_PID" 2>/dev/null || true
echo "PASS: AppImage launched and stayed alive for 8s headless."
echo "--- app log (first 20 lines) ---"
head -20 /tmp/app.log || true
