// Network config form: cell_apn, wifi_ssid, wifi_password, enable_wifi, enable_ble,
// wifi_ap_ssid, wifi_ap_password, sim_pin, apn_username, apn_password.
// Validation: SSID 1-31, password 8-63.

import type { DeviceConfig } from "../lib/tauri";
import { createFormView, type FormView, type Validator } from "./form-shared";

const validators: Partial<Record<keyof DeviceConfig, Validator>> = {
  wifi_ssid: (v) => {
    const s = String(v);
    if (s.length < 1) return "SSID required";
    if (s.length > 31) return "SSID max 31 chars";
    return null;
  },
  wifi_password: (v) => {
    const s = String(v);
    if (s.length > 0 && s.length < 8) return "Password min 8 chars";
    if (s.length > 63) return "Password max 63 chars";
    return null;
  },
  wifi_ap_ssid: (v) => {
    const s = String(v);
    if (s.length > 31) return "AP SSID max 31 chars";
    return null;
  },
  wifi_ap_password: (v) => {
    const s = String(v);
    if (s.length > 0 && s.length < 8) return "AP password min 8 chars";
    if (s.length > 63) return "AP password max 63 chars";
    return null;
  },
};

export function createNetworkView(
  portPath: string,
  config: DeviceConfig,
  onApplied?: (cfg: DeviceConfig) => void
): FormView {
  return createFormView({
    portPath,
    config,
    title: "Network",
    validators,
    onApplied,
    fields: [
      { name: "cell_apn", label: "Cellular APN", type: "text", help: "Carrier APN, e.g. internet" },
      { name: "apn_username", label: "APN Username", type: "text" },
      { name: "apn_password", label: "APN Password", type: "password" },
      { name: "sim_pin", label: "SIM PIN", type: "password", help: "Leave blank if no PIN" },
      { name: "enable_wifi", label: "Enable WiFi (station)", type: "checkbox" },
      { name: "wifi_ssid", label: "WiFi SSID", type: "text", help: "1-31 characters" },
      { name: "wifi_password", label: "WiFi Password", type: "password", help: "8-63 characters (WPA2)" },
      { name: "enable_ble", label: "Enable Bluetooth LE", type: "checkbox" },
      { name: "wifi_ap_ssid", label: "WiFi AP SSID", type: "text", help: "Soft-AP name" },
      { name: "wifi_ap_password", label: "WiFi AP Password", type: "password", help: "8-63 characters" },
    ],
  });
}
