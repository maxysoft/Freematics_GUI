import { describe, it, expect, beforeEach, vi } from "vitest";
import "../components/gauge";
import "../components/form-field";

vi.mock("../lib/tauri", () => ({
  detectDevices: vi.fn(),
  getConfig: vi.fn(),
}));

import { createConnectView } from "./connect";
import { detectDevices, getConfig } from "../lib/tauri";

const mockedDetect = detectDevices as ReturnType<typeof vi.fn>;
const mockedGetConfig = getConfig as ReturnType<typeof vi.fn>;

describe("connect view", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mockedDetect.mockReset();
    mockedGetConfig.mockReset();
  });

  it("renders detected devices", async () => {
    mockedDetect.mockResolvedValue([
      {
        vendor_id: 0x1a86,
        product_id: 0x7523,
        product_name: "CH341",
        manufacturer: "QinHeng",
        port_path: "/dev/ttyUSB0",
      },
    ]);
    const view = createConnectView({ onConnect: () => {} });
    document.body.appendChild(view.el);
    view.mount();
    await view.refresh();
    expect(view.el.textContent).toContain("CH341");
    expect(view.el.textContent).toContain("/dev/ttyUSB0");
    view.unmount();
  });

  it("disables connect when none", async () => {
    mockedDetect.mockResolvedValue([]);
    const view = createConnectView({ onConnect: () => {} });
    document.body.appendChild(view.el);
    view.mount();
    await view.refresh();
    const btn = view.el.querySelector("#connect-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    view.unmount();
  });

  it("calls onConnect with port path", async () => {
    mockedDetect.mockResolvedValue([
      {
        vendor_id: 0x1a86,
        product_id: 0x7523,
        product_name: "CH341",
        manufacturer: "QinHeng",
        port_path: "COM3",
      },
    ]);
    let connected: string | null = null;
    const view = createConnectView({ onConnect: (p) => (connected = p) });
    document.body.appendChild(view.el);
    view.mount();
    await view.refresh();
    const btn = view.el.querySelector("#connect-btn") as HTMLButtonElement;
    btn.click();
    expect(connected).toBe("COM3");
    view.unmount();
  });
});
