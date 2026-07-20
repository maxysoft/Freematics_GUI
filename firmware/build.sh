#!/usr/bin/env bash
# Builds the patched Freematics telelogger firmware inside Docker.
#
# The patch strategy is VENDORED SOURCES: firmware/overlay/ carries fully
# patched copies of the five upstream files we modify (telelogger.ino,
# teleclient.h, teleclient.cpp, telestore.h, dataserver.cpp) plus our own
# additions (configstore, serial_handler). build.sh clones the upstream repo
# at a PINNED commit (everything else — libraries, build system — comes from
# upstream), copies the overlay over it, and builds. No sed/awk patching:
# with the amount of runtime-config surgery involved, vendored files are the
# only maintainable form, and the pinned ref guarantees the rest of the tree
# matches what the vendored files expect.
#
# What the patch does (see overlay/telelogger.ino header comment):
#   - serial config protocol (CFG_DUMP/CFG=/CFG_SAVE/CFG_LOAD/REBOOT + live
#     queries) shared with the desktop app
#   - ALL features compiled in (OBD/MEMS/BLE/HTTPD/WiFi, SD+SPIFFS, UDP+HTTPS)
#     and selected/tuned AT RUNTIME from the NVS config store, so every
#     device-permitted option is changeable from the app without reflashing
set -euo pipefail

# Persist the PlatformIO core dir (platforms/toolchains, ~1GB) in the
# compose-mounted volume. The Dockerfile exported PIO_CORE_DIR, but the
# variable PlatformIO actually honors is PLATFORMIO_CORE_DIR — without it
# every container run re-downloaded the whole ESP32 platform.
export PLATFORMIO_CORE_DIR="${PLATFORMIO_CORE_DIR:-/pio-core}"

FW_DIR="/firmware"
REPO_DIR="${FW_DIR}/repo"
OVERLAY_DIR="${FW_DIR}/overlay"
TELELOGGER_DIR="${REPO_DIR}/firmware_v5/telelogger"
# Pinned upstream commit — the vendored overlay files were derived from this
# exact tree. Bumping it requires re-deriving the vendored files.
FREEMATICS_REF="${FREEMATICS_REF:-9b0a68d}"

echo "==> [1/4] Cloning Freematics repo (ref=${FREEMATICS_REF})"
if [ ! -d "${REPO_DIR}/.git" ]; then
  git clone https://github.com/stanleyhuangyc/Freematics.git "${REPO_DIR}"
fi
git config --global --add safe.directory "${REPO_DIR}"
# The pin is a hard requirement: the vendored overlay files were derived from
# exactly this tree. Fetch only when the commit is missing locally (keeps
# cached/offline builds working), then FAIL LOUDLY if it still can't be
# resolved — silently building against a different tree produces firmware
# that mismatches the vendored sources.
if ! git -C "${REPO_DIR}" rev-parse --quiet --verify "${FREEMATICS_REF}^{commit}" >/dev/null; then
  git -C "${REPO_DIR}" fetch origin
fi
git -C "${REPO_DIR}" rev-parse --verify "${FREEMATICS_REF}^{commit}" >/dev/null
# checkout --force puts the whole worktree at the pinned tree (restoring any
# file a previous run overwrote AND removing tracked files that only exist in
# newer upstream commits); clean sweeps untracked leftovers (stale overlay
# copies) but keeps the .pio build cache.
git -C "${REPO_DIR}" checkout --force --quiet "${FREEMATICS_REF}"
git -C "${REPO_DIR}" clean -fdq -e .pio -- firmware_v5/telelogger/

echo "==> [2/4] Copying overlay (vendored patched sources + additions)"
for f in configstore.h configstore.cpp serial_handler.h serial_handler.cpp \
         telelogger.ino teleclient.h teleclient.cpp telestore.h dataserver.cpp; do
  cp -v "${OVERLAY_DIR}/${f}" "${TELELOGGER_DIR}/"
done

echo "==> [3/4] Appending build flags"
# All features compiled IN; runtime config decides what actually runs.
#  - ENABLE_OBD/MEMS/BLE/HTTPD=1: full feature set, runtime-gated
#  - ENABLE_WIFI: NOT passed — config.h's #ifndef block defaults it to 1 AND
#    defines the companion WIFI_SSID/WIFI_PASSWORD macros; overriding it via
#    -D would skip those and break the build
#  - STORAGE=STORAGE_SD (2): compiles the log endpoints; actual backend is a
#    runtime choice (SD/SPIFFS/none via FileLogger*)
#  - GNSS=GNSS_STANDALONE (1): default only; mode is runtime-branched
#  - CONFIG_MODE_TIMEOUT=0: disable the firmware's own boot-time config stall
if ! grep -q 'ENABLE_SERIAL_CMD' "${TELELOGGER_DIR}/platformio.ini"; then
  printf '\n; --- Freematics Config Manager overlay ---\nbuild_flags = -DENABLE_SERIAL_CMD=1 -DCONFIG_MODE_TIMEOUT=0 -DENABLE_OBD=1 -DENABLE_MEMS=1 -DENABLE_BLE=1 -DENABLE_HTTPD=1 -DSTORAGE=2 -DGNSS=1\n' \
    >> "${TELELOGGER_DIR}/platformio.ini"
fi

echo "==> [4/4] Building"
cd "${TELELOGGER_DIR}"

echo "    -- host-side native tests (g++ direct compile) --"
g++ -std=c++17 -I "${FW_DIR}/test" -I "${OVERLAY_DIR}" \
    "${FW_DIR}/test/configstore_test.cpp" -o /tmp/cs && /tmp/cs
g++ -std=c++17 -I "${FW_DIR}/test" -I "${OVERLAY_DIR}" \
    "${FW_DIR}/test/serial_handler_test.cpp" -o /tmp/sh && /tmp/sh

echo "    -- ESP32 firmware build --"
pio run -e esp32dev

echo "==> DONE. Firmware .bin in ${TELELOGGER_DIR}/.pio/build/esp32dev/firmware.bin"
