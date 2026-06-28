#!/usr/bin/env bash
# Copy the freshly-built patched firmware.bin into firmware/dist/ and update
# manifest.json with the real SHA256. Run inside the `firmware` container from
# the firmware root (the script lives next to build.sh):
#
#   docker compose run --rm firmware bash copy_artifact.sh
#
# Env vars (optional):
#   SRC   - path to the built firmware.bin (auto-detected if unset)
#   COMMIT- git commit the binary was built from (default: 9b0a68d)
set -euo pipefail

# The dist dir is always <script dir>/dist (this script sits at the firmware
# root, alongside build.sh).
DIST_DIR="$(cd "$(dirname "$0")" && pwd)/dist"
mkdir -p "$DIST_DIR"
BIN_NAME="telelogger-patched.bin"
DEST="${DIST_DIR}/${BIN_NAME}"
MANIFEST="${DIST_DIR}/manifest.json"
COMMIT="${COMMIT:-9b0a68d}"
BUILT_AT="$(date -u +%Y-%m-%d)"

# Auto-detect the built firmware.bin if SRC is not provided.
if [[ -z "${SRC:-}" ]]; then
    for candidate in \
        "/firmware/repo/firmware_v5/telelogger/.pio/build/esp32dev/firmware.bin" \
        "/firmware/repo/firmware_v5/telelogger/.pio/build/esp32dev/firmware.bin" \
        "$(pwd)/repo/firmware_v5/telelogger/.pio/build/esp32dev/firmware.bin"; do
        if [[ -f "$candidate" ]]; then
            SRC="$candidate"
            break
        fi
    done
fi

if [[ -z "${SRC:-}" ]] || [[ ! -f "$SRC" ]]; then
    echo "ERROR: firmware.bin not found. Build it first, or set SRC=<path>." >&2
    exit 1
fi

echo "Copying $SRC -> $DEST"
cp -f "$SRC" "$DEST"

SHA="$(sha256sum "$DEST" | awk '{print $1}')"
echo "SHA256: $SHA"

# Rewrite manifest.json preserving field order via a small python helper.
PYTMP="$(mktemp)"
cat > "$PYTMP" <<'PYEOF'
import json, pathlib, sys
manifest, sha, bin_name, commit, built_at = sys.argv[1:6]
m = pathlib.Path(manifest)
data = json.loads(m.read_text())
data["sha256"] = sha
data["binary"] = bin_name
data["built_from_commit"] = commit
data["built_at"] = built_at
m.write_text(json.dumps(data, indent=2) + "\n")
print("manifest.json updated")
PYEOF
python3 "$PYTMP" "$MANIFEST" "$SHA" "$BIN_NAME" "$COMMIT" "$BUILT_AT"
rm -f "$PYTMP"
