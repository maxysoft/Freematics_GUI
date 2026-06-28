// Connect view: polls detectDevices every 2s, shows device cards, Connect button.
//
// Exports a factory returning a root element + lifecycle hooks (mount/unmount).
// On connect, calls onConnect(portPath).

import { detectDevices, getConfig, type DeviceInfo } from "../lib/tauri";

export interface ConnectViewOptions {
  onConnect: (portPath: string) => void;
}

export interface ConnectView {
  el: HTMLElement;
  mount(): void;
  unmount(): void;
  refresh(): Promise<void>;
}

export function createConnectView(opts: ConnectViewOptions): ConnectView {
  const el = document.createElement("section");
  el.className = "connect-view";
  el.setAttribute("aria-label", "Device connection");
  let timer: number | null = null;
  let devices: DeviceInfo[] = [];

  async function refresh(): Promise<void> {
    try {
      devices = await detectDevices();
    } catch {
      devices = [];
    }
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

    el.innerHTML = `
      <header class="view-head">
        <h2>Connect Device</h2>
        <button class="btn ghost" id="refresh-btn" type="button">Refresh</button>
      </header>
      <div class="device-grid">${cards}${empty}</div>
      <footer class="connect-actions">
        <button class="btn primary" id="connect-btn" type="button" ${devices.length === 0 ? "disabled" : ""}>
          Connect
        </button>
      </footer>
    `;

    el.querySelector("#refresh-btn")?.addEventListener("click", () => {
      void refresh();
    });
    el.querySelector("#connect-btn")?.addEventListener("click", () => {
      const first = devices[0];
      if (first) opts.onConnect(first.port_path);
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

  return { el, mount, unmount, refresh };
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
