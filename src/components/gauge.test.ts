import { describe, it, expect, beforeEach } from "vitest";
import "./gauge";

describe("fm-gauge", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders label and value", () => {
    const g = document.createElement("fm-gauge") as HTMLElement & {
      value: number;
    };
    g.setAttribute("label", "Battery");
    g.setAttribute("value", "12.4");
    g.setAttribute("min", "0");
    g.setAttribute("max", "15");
    g.setAttribute("unit", "V");
    g.setAttribute("precision", "1");
    document.body.appendChild(g);
    expect(g.textContent).toContain("Battery");
    expect(g.textContent).toContain("12.4 V");
  });

  it("has role meter and aria-valuenow on host", () => {
    const g = document.createElement("fm-gauge");
    g.setAttribute("value", "50");
    g.setAttribute("min", "0");
    g.setAttribute("max", "100");
    document.body.appendChild(g);
    expect(g.getAttribute("role")).toBe("meter");
    expect(g.getAttribute("aria-valuenow")).toBe("50");
    expect(g.getAttribute("aria-valuemin")).toBe("0");
    expect(g.getAttribute("aria-valuemax")).toBe("100");
  });

  it("updates aria-valuenow when value attribute changes", () => {
    const g = document.createElement("fm-gauge");
    g.setAttribute("value", "10");
    g.setAttribute("min", "0");
    g.setAttribute("max", "100");
    document.body.appendChild(g);
    expect(g.getAttribute("aria-valuenow")).toBe("10");
    g.setAttribute("value", "80");
    expect(g.getAttribute("aria-valuenow")).toBe("80");
  });

  it("clamps value to range", () => {
    const g = document.createElement("fm-gauge");
    g.setAttribute("value", "200");
    g.setAttribute("min", "0");
    g.setAttribute("max", "100");
    document.body.appendChild(g);
    expect(g.textContent).toContain("100");
  });
});
