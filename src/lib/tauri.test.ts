import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  detectDevices,
  listPorts,
  getConfig,
  setConfig,
  getLiveData,
  getFirmwareInfo,
  flashFirmware,
  exportConfig,
  importConfig,
  importWarnings,
  type DeviceConfig,
  type ImportOutcome,
} from "./tauri";

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function setTauri(invokeFn: InvokeFn): void {
  (window as unknown as { __TAURI__: unknown }).__TAURI__ = {
    core: { invoke: invokeFn },
  };
}

function clearTauri(): void {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
}

describe("tauri wrappers", () => {
  beforeEach(() => {
    clearTauri();
  });

  afterEach(() => {
    clearTauri();
  });

  it("detectDevices calls detect_devices_cmd with no args", async () => {
    const invoke = vi.fn(async () => []);
    setTauri(invoke);
    await detectDevices();
    expect(invoke).toHaveBeenCalledWith("detect_devices_cmd", undefined);
  });

  it("listPorts calls list_ports", async () => {
    const invoke = vi.fn(async () => ["/dev/ttyUSB0"]);
    setTauri(invoke);
    await listPorts();
    expect(invoke).toHaveBeenCalledWith("list_ports", undefined);
  });

  it("getConfig passes portPath", async () => {
    const invoke = vi.fn(async () => ({}));
    setTauri(invoke);
    await getConfig("/dev/ttyUSB0");
    expect(invoke).toHaveBeenCalledWith("get_config", { portPath: "/dev/ttyUSB0" });
  });

  it("setConfig passes portPath + config", async () => {
    const invoke = vi.fn(async () => undefined);
    setTauri(invoke);
    const cfg = { server_host: "h" } as DeviceConfig;
    await setConfig("/dev/ttyUSB0", cfg);
    expect(invoke).toHaveBeenCalledWith("set_config", {
      portPath: "/dev/ttyUSB0",
      config: cfg,
    });
  });

  it("getLiveData passes portPath", async () => {
    const invoke = vi.fn(async () => ({}));
    setTauri(invoke);
    await getLiveData("COM3");
    expect(invoke).toHaveBeenCalledWith("get_live_data", { portPath: "COM3" });
  });

  it("getFirmwareInfo calls get_firmware_info", async () => {
    const invoke = vi.fn(async () => ({}));
    setTauri(invoke);
    await getFirmwareInfo();
    expect(invoke).toHaveBeenCalledWith("get_firmware_info", undefined);
  });

  it("flashFirmware passes port", async () => {
    const invoke = vi.fn(async () => undefined);
    setTauri(invoke);
    await flashFirmware("/dev/ttyUSB0");
    expect(invoke).toHaveBeenCalledWith("flash_firmware_cmd", {
      port: "/dev/ttyUSB0",
      firmwarePath: null,
    });
  });

  it("exportConfig passes portPath + savePath", async () => {
    const invoke = vi.fn(async () => undefined);
    setTauri(invoke);
    await exportConfig("/dev/ttyUSB0", "/tmp/backup.json");
    expect(invoke).toHaveBeenCalledWith("export_config_cmd", {
      portPath: "/dev/ttyUSB0",
      savePath: "/tmp/backup.json",
    });
  });

  it("importConfig passes portPath + loadPath", async () => {
    const invoke = vi.fn(async () => ({ Success: true }));
    setTauri(invoke);
    await importConfig("/dev/ttyUSB0", "/tmp/backup.json");
    expect(invoke).toHaveBeenCalledWith("import_config_cmd", {
      portPath: "/dev/ttyUSB0",
      loadPath: "/tmp/backup.json",
    });
  });

  it("importWarnings returns [] for Success", () => {
    const outcome: ImportOutcome = { Success: true };
    expect(importWarnings(outcome)).toEqual([]);
  });

  it("importWarnings returns list for SuccessWithWarnings", () => {
    const outcome: ImportOutcome = {
      SuccessWithWarnings: ["hash mismatch"],
    };
    expect(importWarnings(outcome)).toEqual(["hash mismatch"]);
  });

  it("throws when Tauri global missing", async () => {
    await expect(detectDevices()).rejects.toThrow(/Tauri global/);
  });
});
