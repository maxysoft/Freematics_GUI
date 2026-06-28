// Typed Tauri v2 event listener helpers.
//
// Tauri v2 exposes `window.__TAURI__.event.listen` when
// `app.withGlobalTauri` is true. Each helper returns an unsubscribe
// function. When the Tauri global is absent (browser/test), the helpers
// degrade gracefully: they return a no-op unsubscribe and never throw.

import type { LiveData } from "./tauri";

export interface FlashProgress {
  percentage: number;
  stage: string;
}

interface TauriEventGlobal {
  event: {
    listen<T>(
      event: string,
      handler: (payload: { payload: T }) => void
    ): Promise<() => void>;
  };
}

type TauriWindow = Window & {
  __TAURI__?: TauriEventGlobal;
};

function tauriEvent(): TauriEventGlobal | null {
  const w = window as unknown as TauriWindow;
  return w.__TAURI__ ?? null;
}

/**
 * Subscribe to `flash://progress` events emitted by `flash_firmware_cmd`.
 * Returns an unsubscribe function. When Tauri is unavailable, returns a
 * no-op and reports the absence via the callback's `stage` once.
 */
export function listenFlashProgress(
  cb: (p: FlashProgress) => void
): () => void {
  const t = tauriEvent();
  if (!t) {
    return () => {};
  }
  let active = true;
  let unlisten: (() => void) | null = null;
  t.event
    .listen<FlashProgress>("flash://progress", (evt) => {
      if (!active) return;
      const p = evt.payload;
      if (isFlashProgress(p)) cb(p);
    })
    .then((fn) => {
      if (!active) {
        fn();
        return;
      }
      unlisten = fn;
    })
    .catch(() => {
      active = false;
    });
  return () => {
    active = false;
    if (unlisten) {
      try {
        unlisten();
      } catch {
        /* ignore */
      }
      unlisten = null;
    }
  };
}

/**
 * Subscribe to `live://data` events emitted by `start_live_stream`.
 * Returns an unsubscribe function.
 */
export function listenLiveData(cb: (d: LiveData) => void): () => void {
  const t = tauriEvent();
  if (!t) {
    return () => {};
  }
  let active = true;
  let unlisten: (() => void) | null = null;
  t.event
    .listen<LiveData>("live://data", (evt) => {
      if (!active) return;
      const d = evt.payload;
      if (isLiveData(d)) cb(d);
    })
    .then((fn) => {
      if (!active) {
        fn();
        return;
      }
      unlisten = fn;
    })
    .catch(() => {
      active = false;
    });
  return () => {
    active = false;
    if (unlisten) {
      try {
        unlisten();
      } catch {
        /* ignore */
      }
      unlisten = null;
    }
  };
}

/** Type guard for `FlashProgress` payloads. */
export function isFlashProgress(p: unknown): p is FlashProgress {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.percentage === "number" &&
    typeof o.stage === "string"
  );
}

/** Type guard for `LiveData` payloads. */
export function isLiveData(d: unknown): d is LiveData {
  if (typeof d !== "object" || d === null) return false;
  const o = d as Record<string, unknown>;
  return (
    typeof o.battery_v === "number" &&
    typeof o.rssi === "number" &&
    typeof o.vin === "string" &&
    typeof o.lat === "number" &&
    typeof o.lng === "number" &&
    typeof o.alt === "number" &&
    typeof o.sat === "number" &&
    typeof o.spd === "number" &&
    typeof o.crs === "number" &&
    typeof o.uptime_ms === "number" &&
    typeof o.net_op === "string" &&
    typeof o.net_ip === "string"
  );
}

/**
 * Parse a raw `live://data` event payload into a `LiveData`, or return
 * `null` when the shape is invalid. Used by tests and callers that want
 * defensive parsing without throwing.
 */
export function parseLiveDataEvent(payload: unknown): LiveData | null {
  return isLiveData(payload) ? payload : null;
}
