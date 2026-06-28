## Phase 2 Complete: USB device autodetection

Rust backend detects CH341 (VID 0x1a86, PID 0x7523) via nusb + serialport, maps to OS port path, exposes `detect_devices_cmd` and `list_ports` Tauri commands. Mockable `UsbEnumerator` and `SerialPortOps` traits for testing.

**Files created/changed:**
- src-tauri/Cargo.toml (added serialport, nusb, tokio)
- src-tauri/src/usb/mod.rs
- src-tauri/src/usb/detector.rs (DeviceInfo, UsbEnumerator trait, NusbEnumerator, detect_devices)
- src-tauri/src/usb/serial_port.rs (SerialPortOps trait, RealSerialPort, SerialPortHandle)
- src-tauri/src/commands.rs (detect_devices_cmd, list_ports)
- src-tauri/src/main.rs (wired invoke_handler)
- Dockerfile (added libudev-dev)

**Functions created/changed:**
- detect_devices(), detect_devices_with()
- SerialPortHandle::open/write_line/read_line
- detect_devices_cmd, list_ports (Tauri commands)

**Tests created/changed:**
- usb::detector: detects_ch341_by_vid_pid, filters_non_ch341, handles_no_device
- usb::serial_port: write_line_appends_cr, read_line_strips_terminator, read_line_handles_multiline_until_first_cr

**Review Status:** APPROVED (14/14 tests pass in Docker)

**Git Commit Message:**
```
feat: add USB CH341 autodetection backend

- nusb + serialport detect Freematics ONE+ (1a86:7523)
- Mockable UsbEnumerator/SerialPortOps traits
- Tauri commands detect_devices_cmd, list_ports
- 6 new unit tests, all passing in Docker
```
