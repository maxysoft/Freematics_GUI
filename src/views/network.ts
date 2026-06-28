// Network config form: cell_apn, wifi_ssid, wifi_password, enable_wifi, enable_ble,
// wifi_ap_ssid, wifi_ap_password, sim_pin, apn_username, apn_password.
// Validation: SSID 1-31, password 8-63.

import type { DeviceConfig } from "../lib/tauri";
import { createFormView, type FormView, type Validator } from "./form-shared";

const validators: Partial<Record<keyof DeviceConfig, Validator>> = {
  // SSID/password only matter when WiFi station mode is enabled; don't block
  // Apply over a blank SSID the user never intends to use.
  wifi_ssid: (v, cfg) => {
    if (!cfg.enable_wifi) return null;
    const s = String(v);
    if (s.length < 1) return "SSID required when WiFi station is enabled";
    if (s.length > 31) return "SSID max 31 chars";
    return null;
  },
  wifi_password: (v, cfg) => {
    if (!cfg.enable_wifi) return null;
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
      { name: "cell_apn", label: "Cellular APN", type: "text", help: "Carrier APN, e.g. internet", desc: "Access Point Name for the cellular/SIM data connection. Provided by your mobile carrier (e.g. 'internet'). Required for uploading over the cellular modem." },
      { name: "apn_username", label: "APN Username", type: "text", desc: "Username for the APN, only if your carrier requires authentication. Usually left blank." },
      { name: "apn_password", label: "APN Password", type: "password", desc: "Password for the APN, only if your carrier requires authentication. Usually left blank." },
      { name: "sim_pin", label: "SIM PIN", type: "password", help: "Leave blank if no PIN", desc: "PIN code that unlocks the SIM card at boot. Leave blank if the SIM has no PIN — a wrong PIN can lock the SIM." },
      { name: "enable_wifi", label: "Enable WiFi (station)", type: "checkbox", desc: "Join an existing WiFi network to upload data, instead of (or in addition to) the cellular modem. When off, the SSID/password below are ignored." },
      { name: "wifi_ssid", label: "WiFi SSID", type: "text", help: "1-31 characters", desc: "Name of the WiFi network the device should join when WiFi station mode is enabled." },
      { name: "wifi_password", label: "WiFi Password", type: "password", help: "8-63 characters (WPA2)", desc: "Password for the WiFi network to join. WPA2, 8–63 characters. Leave blank for an open network." },
      { name: "enable_ble", label: "Enable Bluetooth LE", type: "checkbox", desc: "Advertise over Bluetooth Low Energy so nearby phones/apps can connect to the device." },
      { name: "wifi_ap_ssid", label: "WiFi AP SSID", type: "text", help: "Soft-AP name", desc: "Name the device broadcasts as its own WiFi hotspot (soft-AP) for direct local connections." },
      { name: "wifi_ap_password", label: "WiFi AP Password", type: "password", help: "8-63 characters", desc: "Password for the device's own WiFi hotspot. 8–63 characters; leave blank for an open hotspot." },
    ],
  });
}
