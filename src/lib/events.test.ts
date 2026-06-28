import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  listenFlashProgress,
  listenLiveData,
  isFlashProgress,
  isLiveData,
  parseLiveDataEvent,
} from "./events";
import type { LiveData } from "./tauri";

interface TauriEventGlobal {
  event: {
    listen: ReturnType<typeof vi.fn>;
  };
}

function setTauri(t: TauriEventGlobal | null): void {
  Object.defineProperty(window, "__TAURI__", {
    value: t,
    configurable: true,
    writable: true,
  });
}

function sampleLiveData(): LiveData {
  return {
    battery_v: 12.4,
    rssi: -85,
    vin: "1HGCM82633A001234",
    lat: 37.7749,
    lng: -122.4194,
    alt: 16.0,
    sat: 8,
    spd: 0,
    crs: 180,
    uptime_ms: 123456,
    net_op: "T-Mobile",
    net_ip: "10.0.0.1",
  };
}

describe("events helpers", () => {
  beforeEach(() => {
    setTauri(null);
  });

  describe("isFlashProgress", () => {
    it("accepts well-formed payload", () => {
      expect(isFlashProgress({ percentage: 42, stage: "writing" })).toBe(true);
    });
    it("rejects missing fields", () => {
      expect(isFlashProgress({ percentage: 42 })).toBe(false);
      expect(isFlashProgress({ stage: "x" })).toBe(false);
      expect(isFlashProgress(null)).toBe(false);
    });
  });

  describe("isLiveData", () => {
    it("accepts well-formed payload", () => {
      expect(isLiveData(sampleLiveData())).toBe(true);
    });
    it("rejects partial payload", () => {
      expect(isLiveData({ battery_v: 1 })).toBe(false);
    });
  });

  describe("parseLiveDataEvent", () => {
    it("returns parsed data when valid", () => {
      const d = sampleLiveData();
      expect(parseLiveDataEvent(d)).toEqual(d);
    });
    it("returns null when invalid", () => {
      expect(parseLiveDataEvent({ foo: 1 })).toBeNull();
    });
  });

  describe("listenFlashProgress", () => {
    it("calls tauri listen and wires callback, returns unsubscribe", async () => {
      const unlisten = vi.fn();
      const listen = vi.fn().mockResolvedValue(unlisten);
      setTauri({ event: { listen } });

      const cb = vi.fn();
      const unsub = listenFlashProgress(cb);

      await new Promise((r) => setTimeout(r, 0));
      expect(listen).toHaveBeenCalledWith(
        "flash://progress",
        expect.any(Function)
      );

      const handler = listen.mock.calls[0][1];
      handler({ payload: { percentage: 50, stage: "erasing" } });
      expect(cb).toHaveBeenCalledWith({ percentage: 50, stage: "erasing" });

      unsub();
      expect(unlisten).toHaveBeenCalled();
    });

    it("ignores malformed payloads", async () => {
      const unlisten = vi.fn();
      const listen = vi.fn().mockResolvedValue(unlisten);
      setTauri({ event: { listen } });

      const cb = vi.fn();
      const unsub = listenFlashProgress(cb);
      await new Promise((r) => setTimeout(r, 0));

      const handler = listen.mock.calls[0][1];
      handler({ payload: { percentage: "x" } });
      expect(cb).not.toHaveBeenCalled();
      unsub();
    });

    it("returns no-op unsubscribe when tauri absent", () => {
      setTauri(null);
      const unsub = listenFlashProgress(() => {});
      expect(typeof unsub).toBe("function");
      expect(() => unsub()).not.toThrow();
    });
  });

  describe("listenLiveData", () => {
    it("wires callback and unsubscribes", async () => {
      const unlisten = vi.fn();
      const listen = vi.fn().mockResolvedValue(unlisten);
      setTauri({ event: { listen } });

      const cb = vi.fn();
      const unsub = listenLiveData(cb);
      await new Promise((r) => setTimeout(r, 0));

      const handler = listen.mock.calls[0][1];
      const d = sampleLiveData();
      handler({ payload: d });
      expect(cb).toHaveBeenCalledWith(d);

      unsub();
      expect(unlisten).toHaveBeenCalled();
    });
  });
});
