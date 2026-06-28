import { describe, it, expect, vi } from "vitest";

describe("greet", () => {
  it("returns hello", async () => {
    vi.resetModules();
    const { greet } = await import("./main");
    expect(greet()).toBe("hello");
  });
});

describe("app root", () => {
  it("renders an h1 containing Freematics into #app", async () => {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
    await import("./main");
    const h1 = document.querySelector("h1");
    expect(h1?.textContent).toContain("Freematics");
  });
});
