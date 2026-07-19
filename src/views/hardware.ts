// Hardware config form: enable_obd, enable_mems, enable_httpd, gnss_mode (select),
// storage (select), board_has_psram, motion_threshold, jumpstart_voltage,
// cooling_down_temp, gnss_always_on, gnss_reset_timeout, max_obd_errors.

import type { DeviceConfig } from "../lib/tauri";
import { createFormView, type FormView, type Validator } from "./form-shared";

const GNSS_OPTIONS: Array<[string, string]> = [
  ["none", "Off"],
  ["standalone", "Standalone GPS"],
  ["cellular", "Assisted (Cellular)"],
];

const STORAGE_OPTIONS: Array<[string, string]> = [
  ["none", "None"],
  ["spiffs", "SPIFFS (flash)"],
  ["sd", "SD Card"],
];

const validators: Partial<Record<keyof DeviceConfig, Validator>> = {
  motion_threshold: (v) => {
    const n = Number(v);
    if (Number.isNaN(n) || n < 0) return "Must be non-negative";
    return null;
  },
  jumpstart_voltage: (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 30000) return "0-30000 mV";
    return null;
  },
  cooling_down_temp: (v) => {
    const n = Number(v);
    if (Number.isNaN(n)) return "Must be a number";
    return null;
  },
  gnss_reset_timeout: (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) return "Non-negative integer";
    return null;
  },
  max_obd_errors: (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) return "Non-negative integer";
    return null;
  },
};

export function createHardwareView(
  portPath: string,
  config: DeviceConfig,
  onApplied?: (cfg: DeviceConfig) => void
): FormView {
  return createFormView({
    portPath,
    config,
    title: "Hardware",
    validators,
    onApplied,
    fields: [
      { name: "enable_obd", label: "Enable OBD-II", type: "checkbox", desc: "Read vehicle data over the OBD-II port (RPM, speed, coolant temp, etc.). Also used as the wake-up source (jump-start voltage) when MEMS is off. Applied on the next device restart." },
      { name: "enable_mems", label: "Enable MEMS (IMU)", type: "checkbox", desc: "Use the on-board motion sensor for motion/crash detection and motion-based wake-up. Applied on restart." },
      { name: "enable_httpd", label: "Enable HTTP Server", type: "checkbox", desc: "Run a small HTTP server on the device (starts its own WiFi hotspot) for local access and log browsing. Applied on restart." },
      { name: "gnss_mode", label: "GNSS Mode", type: "select", options: GNSS_OPTIONS, desc: "GPS source: Off, Standalone (the device's own GPS chip), or Assisted via the cellular module. Applied on the next device restart." },
      { name: "storage", label: "Storage", type: "select", options: STORAGE_OPTIONS, desc: "Where data is logged locally: none, internal flash (SPIFFS), or an SD card. Applied on restart." },
      { name: "board_has_psram", label: "Board has PSRAM", type: "checkbox", readonly: true, help: "Read-only flag from device", desc: "Indicates the ESP32 module has extra PSRAM. A hardware fact — informational only." },
      { name: "motion_threshold", label: "Motion Threshold", type: "number", min: 0, step: 0.01, desc: "G-force change that counts as motion, used to decide sleep/wake. Higher values are less sensitive. Applied on restart." },
      { name: "jumpstart_voltage", label: "Jump-start Voltage (mV)", type: "number", min: 0, max: 30000, step: 100, help: "Millivolts — e.g. 14500 = 14.5 V", desc: "Battery voltage in millivolts above which the device assumes the engine just started / is charging (e.g. 14500 = 14.5 V). Applied on restart." },
      { name: "cooling_down_temp", label: "Cool-down Temp (°C)", type: "number", step: 0.5, desc: "Device temperature in °C at which it pauses to cool down and avoid overheating. Applied on restart." },
      { name: "gnss_always_on", label: "GNSS Always On", type: "checkbox", desc: "Keep the GPS powered during standby for faster position fixes, at higher power cost. Applied on restart." },
      { name: "gnss_reset_timeout", label: "GNSS Reset Timeout (s)", type: "number", min: 0, step: 1, desc: "Seconds without a GPS fix before the GPS module is reset to recover. 0 keeps the firmware default. Applied on restart." },
      { name: "max_obd_errors", label: "Max OBD Errors", type: "number", min: 0, step: 1, desc: "Consecutive OBD read failures tolerated before the device re-initialises the OBD-II link. Applied on restart." },
    ],
  });
}
