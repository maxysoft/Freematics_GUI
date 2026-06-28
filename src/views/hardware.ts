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
      { name: "enable_obd", label: "Enable OBD-II", type: "checkbox" },
      { name: "enable_mems", label: "Enable MEMS (IMU)", type: "checkbox" },
      { name: "enable_httpd", label: "Enable HTTP Server", type: "checkbox" },
      { name: "gnss_mode", label: "GNSS Mode", type: "select", options: GNSS_OPTIONS },
      { name: "storage", label: "Storage", type: "select", options: STORAGE_OPTIONS },
      { name: "board_has_psram", label: "Board has PSRAM", type: "checkbox", help: "Read-only flag from device" },
      { name: "motion_threshold", label: "Motion Threshold", type: "number", min: 0, step: 0.01 },
      { name: "jumpstart_voltage", label: "Jump-start Voltage (mV)", type: "number", min: 0, max: 30000, step: 100, help: "Millivolts — e.g. 14500 = 14.5 V" },
      { name: "cooling_down_temp", label: "Cool-down Temp (°C)", type: "number", step: 0.5 },
      { name: "gnss_always_on", label: "GNSS Always On", type: "checkbox" },
      { name: "gnss_reset_timeout", label: "GNSS Reset Timeout (s)", type: "number", min: 0, step: 1 },
      { name: "max_obd_errors", label: "Max OBD Errors", type: "number", min: 0, step: 1 },
    ],
  });
}
