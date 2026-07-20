import { describe, it, expect, beforeEach, vi } from "vitest";
import "../components/form-field";

vi.mock("../lib/tauri", () => ({
  setConfig: vi.fn(),
}));

import { createHardwareView } from "./hardware";
import { setConfig } from "../lib/tauri";
import type { DeviceConfig } from "../lib/tauri";

const mockedSetConfig = setConfig as ReturnType<typeof vi.fn>;

function sampleConfig(): DeviceConfig {
  return {
    cell_apn: "internet",
    wifi_ssid: "ssid",
    wifi_password: "password123",
    server_host: "h",
    server_port: 8080,
    server_protocol: "udp",
    server_path: "/api",
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
    wifi_ap_ssid: "Freematics",
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

// Simulate what <fm-field> emits: a change event whose detail.value is a string
// (the raw <input> value), even for type="number" fields.
function emitFieldChange(root: HTMLElement, name: string, value: string): void {
  const field = root.querySelector(`fm-field[name="${name}"]`);
  field?.dispatchEvent(
    new CustomEvent("change", { detail: { name, value }, bubbles: true })
  );
}

describe("hardware view number coercion", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mockedSetConfig.mockReset();
    mockedSetConfig.mockResolvedValue(undefined);
  });

  it("sends number-typed fields as numbers, not strings", async () => {
    const view = createHardwareView("/dev/ttyUSB0", sampleConfig(), () => {});
    document.body.appendChild(view.el);

    // User edits the integer + float number fields. The field emits strings.
    emitFieldChange(view.el, "cooling_down_temp", "80");
    emitFieldChange(view.el, "jumpstart_voltage", "13800");
    emitFieldChange(view.el, "motion_threshold", "0.75");

    const form = view.el.querySelector("#cfg-form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockedSetConfig).toHaveBeenCalledTimes(1);
    const applied = mockedSetConfig.mock.calls[0][1] as DeviceConfig;
    expect(applied.cooling_down_temp).toBe(80);
    expect(applied.jumpstart_voltage).toBe(13800);
    expect(applied.motion_threshold).toBeCloseTo(0.75);
    expect(typeof applied.cooling_down_temp).toBe("number");
    expect(typeof applied.jumpstart_voltage).toBe("number");
    expect(typeof applied.motion_threshold).toBe("number");
  });

  it("renders all fields editable except the PSRAM hardware flag", async () => {
    const view = createHardwareView("/dev/ttyUSB0", sampleConfig(), () => {});
    document.body.appendChild(view.el);
    await new Promise((r) => setTimeout(r, 0));

    // With the runtime-config firmware, protocol/storage/GNSS/toggles are all
    // settable from the app (applied on restart) — only the PSRAM hardware
    // fact stays read-only.
    const gnss = view.el.querySelector('fm-field[name="gnss_mode"] select') as
      | HTMLSelectElement
      | null;
    const obd = view.el.querySelector('fm-field[name="enable_obd"] input') as
      | HTMLInputElement
      | null;
    const cool = view.el.querySelector('fm-field[name="cooling_down_temp"] input') as
      | HTMLInputElement
      | null;
    const psram = view.el.querySelector('fm-field[name="board_has_psram"] input') as
      | HTMLInputElement
      | null;
    expect(gnss?.disabled).toBe(false);
    expect(obd?.disabled).toBe(false);
    expect(cool?.disabled).toBe(false);
    expect(psram?.disabled).toBe(true);
    expect(view.el.querySelector('fm-field[name="board_has_psram"]')?.textContent).toContain(
      "Firmware build-time setting"
    );
  });

  it("blocks Apply when a number field is cleared (string reaches serde otherwise)", async () => {
    const view = createHardwareView("/dev/ttyUSB0", sampleConfig(), () => {});
    document.body.appendChild(view.el);

    // A cleared <input type=number> emits "" — Number("") === 0 would pass
    // naive validators, then serde would reject the string for i32.
    emitFieldChange(view.el, "max_obd_errors", "");

    const form = view.el.querySelector("#cfg-form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockedSetConfig).not.toHaveBeenCalled();
    const field = view.el.querySelector('fm-field[name="max_obd_errors"]');
    expect(field?.getAttribute("error")).toContain("number");
  });

  it("rejects fractional cool-down temp (device stores whole °C)", async () => {
    const view = createHardwareView("/dev/ttyUSB0", sampleConfig(), () => {});
    document.body.appendChild(view.el);
    emitFieldChange(view.el, "cooling_down_temp", "80.5");

    const form = view.el.querySelector("#cfg-form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockedSetConfig).not.toHaveBeenCalled();
  });

  it("still applies with read-only fields present (no validation block)", async () => {
    const view = createHardwareView("/dev/ttyUSB0", sampleConfig(), () => {});
    document.body.appendChild(view.el);
    emitFieldChange(view.el, "max_obd_errors", "7");

    const form = view.el.querySelector("#cfg-form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockedSetConfig).toHaveBeenCalledTimes(1);
    const applied = mockedSetConfig.mock.calls[0][1] as DeviceConfig;
    expect(applied.max_obd_errors).toBe(7);
  });
});
