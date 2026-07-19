// Typed wrappers around the Tauri v2 global invoke bridge.
//
// Tauri v2 exposes `window.__TAURI__.core.invoke` when `app.withGlobalTauri`
// is true in tauri.conf.json. We avoid pulling in `@tauri-apps/api` so the
// frontend stays dependency-free.

export type ServerProtocol = "udp" | "https_get" | "https_post";
export type GnssMode = "none" | "standalone" | "cellular";
export type StorageMode = "none" | "spiffs" | "sd";

export interface DeviceInfo {
  vendor_id: number;
  product_id: number;
  product_name: string;
  manufacturer: string;
  port_path: string;
}

export interface DeviceConfig {
  cell_apn: string;
  wifi_ssid: string;
  wifi_password: string;
  server_host: string;
  server_port: number;
  server_protocol: ServerProtocol;
  server_path: string;
  gnss_mode: GnssMode;
  storage: StorageMode;
  enable_obd: boolean;
  enable_mems: boolean;
  enable_wifi: boolean;
  enable_ble: boolean;
  enable_httpd: boolean;
  sim_pin: string;
  apn_username: string;
  apn_password: string;
  wifi_ap_ssid: string;
  wifi_ap_password: string;
  motion_threshold: number;
  jumpstart_voltage: number;
  cooling_down_temp: number;
  gnss_always_on: boolean;
  gnss_reset_timeout: number;
  max_obd_errors: number;
  server_sync_interval: number;
  ping_back_interval: number;
  board_has_psram: boolean;
}

export interface LiveData {
  battery_v: number;
  rssi: number;
  vin: string;
  lat: number;
  lng: number;
  alt: number;
  sat: number;
  spd: number;
  crs: number;
  uptime_ms: number;
  net_op: string;
  net_ip: string;
}

export interface FirmwareInfo {
  version: string;
  sha256: string;
  binary: string;
  built_from_commit: string;
}

export type ImportOutcome =
  | { Success: true }
  | { SuccessWithWarnings: string[] };

/** Normalize the ImportOutcome enum into a warnings list. */
export function importWarnings(outcome: ImportOutcome): string[] {
  if ("SuccessWithWarnings" in outcome) {
    return outcome.SuccessWithWarnings;
  }
  return [];
}

interface TauriGlobal {
  core: {
    invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  };
}

function tauri(): TauriGlobal {
  const w = window as unknown as { __TAURI__?: TauriGlobal };
  if (!w.__TAURI__) {
    throw new Error(
      "Tauri global not available. Ensure app.withGlobalTauri is true."
    );
  }
  return w.__TAURI__;
}

// Keys whose values must never be logged (passwords, PIN).
const SECRET_ARG_KEYS = new Set([
  "config",
  "wifi_password",
  "wifi_ap_password",
  "apn_password",
  "sim_pin",
]);

function redactArgs(args?: Record<string, unknown>): Record<string, unknown> {
  if (!args) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = SECRET_ARG_KEYS.has(k) ? "***" : v;
  }
  return out;
}

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    console.debug(`[invoke] ${cmd}`, redactArgs(args));
    return tauri()
      .core.invoke<T>(cmd, args)
      .catch((err) => {
        console.error(`[invoke] ${cmd} failed:`, err);
        throw err;
      });
  } catch (err) {
    console.error(`[invoke] ${cmd} threw synchronously:`, err);
    return Promise.reject(err);
  }
}

export function detectDevices(): Promise<DeviceInfo[]> {
  return invoke<DeviceInfo[]>("detect_devices_cmd");
}

export function listPorts(): Promise<string[]> {
  return invoke<string[]>("list_ports");
}

export function getConfig(portPath: string): Promise<DeviceConfig> {
  return invoke<DeviceConfig>("get_config", { portPath });
}

export function setConfig(portPath: string, config: DeviceConfig): Promise<void> {
  return invoke<void>("set_config", { portPath, config });
}

export function getLiveData(portPath: string): Promise<LiveData> {
  return invoke<LiveData>("get_live_data", { portPath });
}

/** Restart the device so freshly saved config takes effect (applied at boot). */
export function rebootDevice(portPath: string): Promise<void> {
  return invoke<void>("reboot_device", { portPath });
}

export function getFirmwareInfo(): Promise<FirmwareInfo> {
  return invoke<FirmwareInfo>("get_firmware_info");
}

export function flashFirmware(
  portPath: string,
  firmwarePath?: string | null
): Promise<void> {
  return invoke<void>("flash_firmware_cmd", {
    port: portPath,
    firmwarePath: firmwarePath ?? null,
  });
}

/** Native dialog to pick a firmware .bin (Tauri only; null elsewhere). */
export function pickFirmwarePath(): Promise<string | null> {
  return invoke<string | null>("pick_firmware_path");
}

/** Native save dialog for a backup path (Tauri only; null elsewhere). */
export function pickSavePath(defaultName: string): Promise<string | null> {
  return invoke<string | null>("pick_save_path", { defaultName });
}

/** True if the Tauri bridge is present (i.e. running in the desktop app). */
export function hasTauri(): boolean {
  const w = window as unknown as { __TAURI__?: unknown };
  return !!w.__TAURI__;
}

export function exportConfig(portPath: string, savePath: string): Promise<void> {
  return invoke<void>("export_config_cmd", { portPath, savePath });
}

export function importConfig(
  portPath: string,
  loadPath: string
): Promise<ImportOutcome> {
  return invoke<ImportOutcome>("import_config_cmd", { portPath, loadPath });
}
