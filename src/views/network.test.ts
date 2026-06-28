import { describe, it, expect, beforeEach, vi } from "vitest";
import "../components/gauge";
import "../components/form-field";

vi.mock("../lib/tauri", () => ({
  setConfig: vi.fn(),
}));

import { createNetworkView } from "./network";
import { setConfig } from "../lib/tauri";
import type { DeviceConfig } from "../lib/tauri";

const mockedSetConfig = setConfig as ReturnType<typeof vi.fn>;

function sampleConfig(): DeviceConfig {
  return {
    cell_apn: "internet",
    wifi_ssid: "oldssid",
    wifi_password: "short",
    server_host: "h",
    server_port: 8080,
    server_protocol: "udp",
    server_path: "/api",
    gnss_mode: "standalone",
    storage: "sd",
    enable_obd: true,
    enable_mems: false,
    enable_wifi: true,
    enable_ble: false,
    enable_httpd: false,
    sim_pin: "",
    apn_username: "",
    apn_password: "",
    wifi_ap_ssid: "",
    wifi_ap_password: "",
    motion_threshold: 0.5,
    jumpstart_voltage: 11.5,
    cooling_down_temp: 70,
    gnss_always_on: false,
    gnss_reset_timeout: 0,
    max_obd_errors: 5,
    server_sync_interval: 60,
    ping_back_interval: 30,
    board_has_psram: false,
  };
}

describe("network view", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mockedSetConfig.mockReset();
    mockedSetConfig.mockResolvedValue(undefined);
  });

  it("shows apn help", () => {
    const view = createNetworkView("/dev/ttyUSB0", sampleConfig(), () => {});
    document.body.appendChild(view.el);
    expect(view.el.textContent).toContain("Carrier APN");
  });

  it("validates ssid length", async () => {
    const cfg = sampleConfig();
    cfg.wifi_ssid = "";
    const view = createNetworkView("/dev/ttyUSB0", cfg, () => {});
    document.body.appendChild(view.el);
    const form = view.el.querySelector("#cfg-form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    const ssidField = view.el.querySelector('fm-field[name="wifi_ssid"]');
    expect(ssidField?.getAttribute("error")).toContain("SSID required");
    expect(mockedSetConfig).not.toHaveBeenCalled();
  });

  it("validates ssid max 31", async () => {
    const cfg = sampleConfig();
    cfg.wifi_ssid = "x".repeat(40);
    const view = createNetworkView("/dev/ttyUSB0", cfg, () => {});
    document.body.appendChild(view.el);
    const form = view.el.querySelector("#cfg-form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    const ssidField = view.el.querySelector('fm-field[name="wifi_ssid"]');
    expect(ssidField?.getAttribute("error")).toContain("31");
  });

  it("validates password 8-63", async () => {
    const cfg = sampleConfig();
    cfg.wifi_password = "short";
    const view = createNetworkView("/dev/ttyUSB0", cfg, () => {});
    document.body.appendChild(view.el);
    const form = view.el.querySelector("#cfg-form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    const pwdField = view.el.querySelector('fm-field[name="wifi_password"]');
    expect(pwdField?.getAttribute("error")).toContain("8");
  });

  it("does not require ssid when WiFi station is disabled", async () => {
    const cfg = sampleConfig();
    cfg.enable_wifi = false;
    cfg.wifi_ssid = "";
    cfg.wifi_password = "";
    const view = createNetworkView("/dev/ttyUSB0", cfg, () => {});
    document.body.appendChild(view.el);
    const form = view.el.querySelector("#cfg-form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const ssidField = view.el.querySelector('fm-field[name="wifi_ssid"]');
    expect(ssidField?.getAttribute("error")).toBe("");
    expect(mockedSetConfig).toHaveBeenCalled();
  });

  it("applies valid config", async () => {
    const cfg = sampleConfig();
    cfg.wifi_ssid = "goodssid";
    cfg.wifi_password = "goodpassword123";
    const view = createNetworkView("/dev/ttyUSB0", cfg, () => {});
    document.body.appendChild(view.el);
    const form = view.el.querySelector("#cfg-form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(mockedSetConfig).toHaveBeenCalled();
  });
});
