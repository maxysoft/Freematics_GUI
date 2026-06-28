## Phase 4 Complete: Patched firmware (serial handler + extended NVS)

Patched telelogger firmware adds processSerial() command dispatcher, Config struct over NVS namespace "cfg" with all 28 params, CFG_DUMP/CFG_LOAD/CFG_SAVE/CFG= commands. Builds via PlatformIO in Docker; ESP32 firmware.bin = 1.62MB (Flash 51.3%, RAM 18.4%). Host-side native tests (59 assertions) pass.

**Files created/changed:**
- firmware/Dockerfile, firmware/build.sh, firmware/README.md
- firmware/overlay/configstore.h, configstore.cpp, serial_handler.h, serial_handler.cpp, platformio.ini
- firmware/test/Arduino.h, mock_nvs.h, mock_serial.h, configstore_test.cpp, serial_handler_test.cpp, README.md
- docker-compose.yml (added firmware service)

**Functions created/changed:**
- Config::load/save/dump/set/get (NVS-backed, 28 fields)
- processSerial(Config&) — command dispatcher
- build.sh — clones Freematics, overlays patches, sed-patches telelogger.ino, builds

**Tests created/changed:**
- configstore_test.cpp (36 assertions)
- serial_handler_test.cpp (23 assertions)

**Review Status:** APPROVED (host tests pass, ESP32 build succeeds)

**Git Commit Message:**
```
feat: patched telelogger firmware with serial config protocol

- Config struct over NVS namespace "cfg", 28 params
- processSerial() dispatcher: CFG_DUMP/LOAD/SAVE/set + legacy APN/SSID/WPWD
- PlatformIO Docker build, ESP32 firmware.bin 1.62MB
- 59 host-side native test assertions passing
```
