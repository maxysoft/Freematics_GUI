import { describe, it, expect } from "vitest";
import { AppState } from "./state";
import type { DeviceConfig } from "./tauri";

function cfg(): DeviceConfig {
  return {
    cell_apn: "internet",
    wifi_ssid: "",
    wifi_password: "",
    server_host: "hub.freematics.com",
    server_port: 0,
    server_protocol: "udp",
    server_path: "",
    gnss_mode: "standalone",
    storage: "none",
    enable_obd: true,
    enable_mems: true,
    enable_wifi: false,
    enable_ble: false,
    enable_httpd: false,
    sim_pin: "",
    apn_username: "",
    apn_password: "",
    wifi_ap_ssid: "",
    wifi_ap_password: "",
    motion_threshold: 0.4,
    jumpstart_voltage: 14500,
    cooling_down_temp: 80,
    gnss_always_on: false,
    gnss_reset_timeout: 0,
    max_obd_errors: 5,
    server_sync_interval: 30,
    ping_back_interval: 0,
    board_has_psram: false,
  };
}

describe("AppState config updates", () => {
  it("setConfig notifies listeners (full re-render path)", () => {
    const s = new AppState();
    let calls = 0;
    s.onChange(() => calls++);
    s.setConfig(cfg());
    expect(calls).toBe(1);
    expect(s.currentConfig?.cell_apn).toBe("internet");
  });

  it("setConfigQuiet stores WITHOUT notifying — Apply must not rebuild the view", () => {
    // Regression: the emitting variant rebuilt the dashboard on Apply,
    // destroying the just-revealed "Restart device now" button.
    const s = new AppState();
    let calls = 0;
    s.onChange(() => calls++);
    s.setConfigQuiet(cfg());
    expect(calls).toBe(0);
    expect(s.currentConfig?.cell_apn).toBe("internet");
  });
});
