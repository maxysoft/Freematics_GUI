import { describe, it, expect, beforeEach } from "vitest";
import "./form-field";

describe("fm-field", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders label + text input", () => {
    const f = document.createElement("fm-field");
    f.setAttribute("name", "ssid");
    f.setAttribute("label", "WiFi SSID");
    f.setAttribute("type", "text");
    f.setAttribute("value", "MyNet");
    document.body.appendChild(f);
    expect(f.textContent).toContain("WiFi SSID");
    const input = f.querySelector("input");
    expect(input?.value).toBe("MyNet");
  });

  it("shows help text", () => {
    const f = document.createElement("fm-field");
    f.setAttribute("name", "apn");
    f.setAttribute("label", "APN");
    f.setAttribute("help", "Carrier APN");
    document.body.appendChild(f);
    expect(f.textContent).toContain("Carrier APN");
  });

  it("shows error and sets aria-invalid", () => {
    const f = document.createElement("fm-field");
    f.setAttribute("name", "ssid");
    f.setAttribute("label", "SSID");
    f.setAttribute("error", "Too short");
    document.body.appendChild(f);
    const input = f.querySelector("input");
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(f.textContent).toContain("Too short");
  });

  it("renders select with options", () => {
    const f = document.createElement("fm-field");
    f.setAttribute("name", "proto");
    f.setAttribute("label", "Protocol");
    f.setAttribute("type", "select");
    f.setAttribute("value", "udp");
    f.setAttribute("options", JSON.stringify([["udp", "UDP"], ["https_get", "HTTPS GET"]]));
    document.body.appendChild(f);
    const sel = f.querySelector("select");
    expect(sel).toBeTruthy();
    expect(sel?.querySelectorAll("option").length).toBe(2);
    expect(sel?.value).toBe("udp");
  });

  it("renders checkbox and toggles", () => {
    const f = document.createElement("fm-field");
    f.setAttribute("name", "wifi");
    f.setAttribute("label", "Enable WiFi");
    f.setAttribute("type", "checkbox");
    f.setAttribute("value", "true");
    document.body.appendChild(f);
    const cb = f.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it("emits change event with name + value", () => {
    const f = document.createElement("fm-field");
    f.setAttribute("name", "ssid");
    f.setAttribute("label", "SSID");
    f.setAttribute("type", "text");
    document.body.appendChild(f);
    const input = f.querySelector("input") as HTMLInputElement;
    input.value = "NewSSID";
    let detail: { name: string; value: string | boolean } | null = null;
    f.addEventListener("change", (e: Event) => {
      detail = (e as CustomEvent).detail;
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(detail).toEqual({ name: "ssid", value: "NewSSID" });
  });
});
