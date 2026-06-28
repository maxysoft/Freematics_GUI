import { describe, it, expect, beforeEach, vi } from "vitest";
import "../components/gauge";
import "../components/form-field";

vi.mock("../lib/tauri", () => ({
  exportConfig: vi.fn(),
  importConfig: vi.fn(),
  getFirmwareInfo: vi.fn(),
  importWarnings: vi.fn((o: { SuccessWithWarnings?: string[] }) =>
    "SuccessWithWarnings" in o ? o.SuccessWithWarnings : []
  ),
}));

import { createBackupView } from "./backup";
import {
  exportConfig,
  importConfig,
  getFirmwareInfo,
} from "../lib/tauri";

const mockedExport = exportConfig as ReturnType<typeof vi.fn>;
const mockedImport = importConfig as ReturnType<typeof vi.fn>;
const mockedFirmware = getFirmwareInfo as ReturnType<typeof vi.fn>;

describe("backup view", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mockedExport.mockReset();
    mockedImport.mockReset();
    mockedFirmware.mockReset();
    mockedFirmware.mockResolvedValue({
      version: "1.2.3",
      sha256: "abc",
      binary: "telelogger.bin",
      built_from_commit: "deadbeef",
    });
  });

  it("triggers export download", async () => {
    mockedExport.mockResolvedValue(undefined);
    const view = createBackupView({ portPath: "/dev/ttyUSB0" });
    document.body.appendChild(view.el);
    await new Promise((r) => setTimeout(r, 0));
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("out.json");
    view.el.querySelector("#export-btn")?.dispatchEvent(new Event("click"));
    await new Promise((r) => setTimeout(r, 0));
    expect(mockedExport).toHaveBeenCalledWith("/dev/ttyUSB0", "/tmp/out.json");
    promptSpy.mockRestore();
  });

  it("confirms before import", async () => {
    mockedImport.mockResolvedValue({ Success: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const view = createBackupView({ portPath: "/dev/ttyUSB0" });
    document.body.appendChild(view.el);
    await new Promise((r) => setTimeout(r, 0));
    const file = new File(["{}"], "backup.json", { type: "application/json" });
    const input = view.el.querySelector("#import-file") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));
    expect(confirmSpy).toHaveBeenCalled();
    expect(mockedImport).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("runs import when confirmed and shows warnings", async () => {
    mockedImport.mockResolvedValue({ SuccessWithWarnings: ["hash mismatch"] });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const view = createBackupView({ portPath: "/dev/ttyUSB0" });
    document.body.appendChild(view.el);
    await new Promise((r) => setTimeout(r, 0));
    const file = new File(["{}"], "backup.json", { type: "application/json" });
    const input = view.el.querySelector("#import-file") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(mockedImport).toHaveBeenCalledWith("/dev/ttyUSB0", "/tmp/backup.json");
    const warnings = view.el.querySelector("#import-warnings");
    expect(warnings?.textContent).toContain("hash mismatch");
    confirmSpy.mockRestore();
  });
});
