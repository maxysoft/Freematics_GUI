import { describe, it, expect, beforeEach, vi } from "vitest";
import "../components/gauge";
import "../components/form-field";

vi.mock("../lib/tauri", () => ({
  exportConfig: vi.fn(),
  importConfig: vi.fn(),
  flashFirmware: vi.fn(),
}));

vi.mock("../lib/events", () => ({
  listenFlashProgress: vi.fn(),
}));

import { createFlashWizardView } from "./flash-wizard";
import {
  exportConfig,
  importConfig,
  flashFirmware,
} from "../lib/tauri";
import { listenFlashProgress } from "../lib/events";

const mockedExport = exportConfig as ReturnType<typeof vi.fn>;
const mockedImport = importConfig as ReturnType<typeof vi.fn>;
const mockedFlash = flashFirmware as ReturnType<typeof vi.fn>;
const mockedListen = listenFlashProgress as ReturnType<typeof vi.fn>;

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function setChecked(view: { el: HTMLElement }, checked: boolean): void {
  const box = view.el.querySelector("#ack-check") as HTMLInputElement;
  box.checked = checked;
  box.dispatchEvent(new Event("change"));
}

function clickNext(view: { el: HTMLElement }): void {
  view.el.querySelector("#wizard-next")?.dispatchEvent(new Event("click"));
}

describe("flash wizard", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mockedExport.mockReset();
    mockedImport.mockReset();
    mockedFlash.mockReset();
    mockedListen.mockReset();
    mockedExport.mockResolvedValue(undefined);
    mockedImport.mockResolvedValue({ Success: true });
    // flashFirmware stays pending so the wizard remains on the flash step
    // until a progress event at 100% drives it forward.
    mockedFlash.mockImplementation(() => new Promise(() => {}));
    // Capture the progress callback so tests can drive it manually.
    mockedListen.mockImplementation((cb: (p: { percentage: number; stage: string }) => void) => {
      (mockedListen as unknown as { _cb: typeof cb })._cb = cb;
      return () => {};
    });
  });

  it("shows warning first", () => {
    const view = createFlashWizardView({
      portPath: "/dev/ttyUSB0",
      onClose: () => {},
    });
    document.body.appendChild(view.el);
    expect(view.el.textContent).toContain("reflash your device firmware");
    expect(view.el.querySelector("#ack-check")).not.toBeNull();
    const next = view.el.querySelector("#wizard-next") as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it("disables next until checkbox checked", () => {
    const view = createFlashWizardView({
      portPath: "/dev/ttyUSB0",
      onClose: () => {},
    });
    document.body.appendChild(view.el);
    let next = view.el.querySelector("#wizard-next") as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    setChecked(view, true);
    next = view.el.querySelector("#wizard-next") as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    setChecked(view, false);
    next = view.el.querySelector("#wizard-next") as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });

  it("disables cancel during flash", async () => {
    const view = createFlashWizardView({
      portPath: "/dev/ttyUSB0",
      onClose: () => {},
    });
    document.body.appendChild(view.el);
    setChecked(view, true);
    clickNext(view); // step 0 -> 1, auto backup
    await flush();
    await flush();
    await flush();
    expect(view.el.textContent).toContain("Backup complete");
    clickNext(view); // step 1 -> 2, starts flash
    await flush();
    await flush();
    expect(view.el.querySelector(".wizard-flash")).not.toBeNull();
    const cancel = view.el.querySelector("#wizard-cancel") as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
  });

  it("displays progress bar and updates on flash://progress event", async () => {
    const view = createFlashWizardView({
      portPath: "/dev/ttyUSB0",
      onClose: () => {},
    });
    document.body.appendChild(view.el);
    setChecked(view, true);
    clickNext(view); // -> step 1 backup
    await flush();
    await flush();
    await flush();
    clickNext(view); // -> step 2 flash
    await flush();
    await flush();

    expect(view.el.querySelector(".progress-bar")).not.toBeNull();
    const cb = (mockedListen as unknown as { _cb: (p: { percentage: number; stage: string }) => void })._cb;
    cb({ percentage: 50, stage: "writing" });
    const bar = view.el.querySelector(".progress-bar") as HTMLElement;
    expect(bar.style.width).toBe("50%");
    expect(view.el.textContent).toContain("writing");
  });

  it("calls exportConfig on backup step", async () => {
    const view = createFlashWizardView({
      portPath: "/dev/ttyUSB0",
      backupPath: "/tmp/bk.json",
      onClose: () => {},
    });
    document.body.appendChild(view.el);
    setChecked(view, true);
    clickNext(view); // -> step 1, auto backup
    await flush();
    await flush();
    await flush();
    expect(mockedExport).toHaveBeenCalledWith("/dev/ttyUSB0", "/tmp/bk.json");
    expect(view.el.textContent).toContain("Backup complete");
  });

  it("calls importConfig on restore step", async () => {
    const view = createFlashWizardView({
      portPath: "/dev/ttyUSB0",
      backupPath: "/tmp/bk.json",
      onClose: () => {},
    });
    document.body.appendChild(view.el);
    setChecked(view, true);
    clickNext(view); // -> step 1 backup
    await flush();
    await flush();
    await flush();
    clickNext(view); // -> step 2 flash
    await flush();
    await flush();
    // Drive progress to 100% to auto-advance to restore.
    const cb = (mockedListen as unknown as { _cb: (p: { percentage: number; stage: string }) => void })._cb;
    cb({ percentage: 100, stage: "done" });
    await flush();
    await flush();
    await flush();
    expect(mockedImport).toHaveBeenCalledWith("/dev/ttyUSB0", "/tmp/bk.json");
    expect(view.el.textContent).toContain("Restore complete");
  });

  it("closes on Done after restore", async () => {
    const onClose = vi.fn();
    const onRestored = vi.fn();
    const view = createFlashWizardView({
      portPath: "/dev/ttyUSB0",
      backupPath: "/tmp/bk.json",
      onClose,
      onRestored,
    });
    document.body.appendChild(view.el);
    setChecked(view, true);
    clickNext(view);
    await flush();
    await flush();
    await flush();
    clickNext(view);
    await flush();
    await flush();
    const cb = (mockedListen as unknown as { _cb: (p: { percentage: number; stage: string }) => void })._cb;
    cb({ percentage: 100, stage: "done" });
    await flush();
    await flush();
    await flush();
    const done = view.el.querySelector("#wizard-done") as HTMLButtonElement;
    expect(done.disabled).toBe(false);
    done.dispatchEvent(new Event("click"));
    expect(onRestored).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("cancel on step 1 closes wizard", () => {
    const onClose = vi.fn();
    const view = createFlashWizardView({
      portPath: "/dev/ttyUSB0",
      onClose,
    });
    document.body.appendChild(view.el);
    setChecked(view, true);
    clickNext(view); // -> step 1
    view.el.querySelector("#wizard-cancel")?.dispatchEvent(new Event("click"));
    expect(onClose).toHaveBeenCalled();
  });
});
