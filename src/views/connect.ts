// Connect view: polls detectDevices every 2s, shows device cards, Connect button.
//
// Exports a factory returning a root element + lifecycle hooks (mount/unmount).
// On connect, calls onConnect(portPath). A failed connect is shown via
// setError(), rendered as part of view state so the 2s refresh can't wipe it.

import { detectDevices, getConfig, type DeviceInfo } from "../lib/tauri";

export interface ConnectViewOptions {
  onConnect: (portPath: string) => void;
  /** Offer to flash firmware on a detected-but-unconfigured device. */
  onSetup?: (portPath: string) => void;
}

export interface ConnectView {
  el: HTMLElement;
  mount(): void;
  unmount(): void;
  refresh(): Promise<void>;
  /** Show/hide a blocking "Connecting…" overlay. Pass a port to show, null to hide. */
  setConnecting(portPath: string | null): void;
  /** Show/clear a connect-failure block (with a "Set up device" action). */
  setError(info: { port: string; message: string } | null): void;
}

export function createConnectView(opts: ConnectViewOptions): ConnectView {
  const el = document.createElement("section");
  el.className = "connect-view";
  el.setAttribute("aria-label", "Device connection");
  let timer: number | null = null;
  let devices: DeviceInfo[] = [];
  let connecting: string | null = null;
  let errorState: { port: string; message: string } | null = null;

  async function refresh(): Promise<void> {
    if (connecting) return; // don't churn the list mid-connect
    try {
      devices = await detectDevices();
    } catch {
      devices = [];
    }
    render();
  }

  function setConnecting(portPath: string | null): void {
    connecting = portPath;
    if (portPath) errorState = null; // a fresh attempt clears the prior error
    render();
  }

  function setError(info: { port: string; message: string } | null): void {
    errorState = info;
    render();
  }

  function render(): void {
    const cards = devices
      .map(
        (d) => `
        <article class="device-card" tabindex="0" data-port="${escapeAttr(d.port_path)}">
          <h3>${escapeText(d.product_name || "Unknown device")}</h3>
          <p class="muted">${escapeText(d.manufacturer || "Unknown manufacturer")}</p>
          <p class="port">${escapeText(d.port_path)}</p>
          <p class="muted">VID:${d.vendor_id.toString(16)} PID:${d.product_id.toString(16)}</p>
        </article>`
      )
      .join("");

    const empty = devices.length === 0
      ? `<p class="empty" role="status">No Freematics ONE+ detected. Connect a USB cable…</p>`
      : "";

    const errorBlock = errorState
      ? `
        <div class="connect-error-block">
          <p class="err" role="alert">Couldn't read config from ${escapeText(errorState.port)}${
            errorState.message ? `: ${escapeText(errorState.message)}` : "."
          }</p>
          <p class="muted">New device? It likely needs the Freematics Config Manager firmware. Set it up below — this flashes the firmware, then opens the configurator. No other software required.</p>
          <button class="btn primary" id="connect-setup-btn" type="button">Set up device (flash firmware)</button>
        </div>`
      : "";

    const overlay = connecting
      ? `
        <div class="connect-overlay" role="status" aria-live="assertive">
          <div class="spinner" aria-hidden="true"></div>
          <p>Connecting to ${escapeText(connecting)}…</p>
          <p class="muted">Reading device configuration — this can take a few seconds.</p>
        </div>`
      : "";

    el.innerHTML = `
      <header class="view-head">
        <h2>Connect Device</h2>
        <button class="btn ghost" id="refresh-btn" type="button" ${connecting ? "disabled" : ""}>Refresh</button>
      </header>
      <div class="device-grid">${cards}${empty}</div>
      <footer class="connect-actions">
        <button class="btn primary" id="connect-btn" type="button" ${devices.length === 0 || connecting ? "disabled" : ""}>
          Connect
        </button>
      </footer>
      ${errorBlock}
      ${overlay}
    `;

    el.querySelector("#refresh-btn")?.addEventListener("click", () => {
      errorState = null; // user asked for a fresh scan
      void refresh();
    });
    el.querySelector("#connect-btn")?.addEventListener("click", () => {
      const first = devices[0];
      if (first) opts.onConnect(first.port_path);
    });
    el.querySelector("#connect-setup-btn")?.addEventListener("click", () => {
      if (errorState) opts.onSetup?.(errorState.port);
    });
    el.querySelectorAll<HTMLElement>(".device-card").forEach((card) => {
      card.addEventListener("click", () => {
        const port = card.dataset.port;
        if (port) opts.onConnect(port);
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          const port = card.dataset.port;
          if (port) opts.onConnect(port);
        }
      });
    });
  }

  function mount(): void {
    render();
    void refresh();
    timer = window.setInterval(() => void refresh(), 2000);
  }

  function unmount(): void {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  return { el, mount, unmount, refresh, setConnecting, setError };
}

// Helper used by main.ts to fetch config after connect.
export async function connectAndLoadConfig(
  portPath: string
): Promise<{
  port: string;
  config: Awaited<ReturnType<typeof getConfig>> | null;
  error: string | null;
}> {
  try {
    const config = await getConfig(portPath);
    return { port: portPath, config, error: null };
  } catch (err) {
    // Surface the real backend reason (timeout, parse error, port busy) instead
    // of swallowing it — the previous silent failure hid every diagnostic.
    const error = err instanceof Error ? err.message : String(err);
    console.error(`connectAndLoadConfig(${portPath}) failed:`, error);
    return { port: portPath, config: null, error };
  }
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}
