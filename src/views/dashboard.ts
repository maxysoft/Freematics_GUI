// Dashboard view: tab bar (Live Data, Network, Server, Hardware, Backup) + content
// area. Polls getLiveData every 1s on the Live tab and renders gauges for
// BATT/RSSI/SAT/SPD. Other tabs render their respective form views.

import "../components/gauge";
import { getLiveData, type DeviceConfig, type LiveData } from "../lib/tauri";
import { createNetworkView, type FormView } from "./network";
import { createServerView } from "./server";
import { createHardwareView } from "./hardware";
import { createBackupView } from "./backup";

export type DashboardTab = "live" | "network" | "server" | "hardware" | "backup";

export interface DashboardViewOptions {
  portPath: string;
  config: DeviceConfig;
  onConfigChanged?: (cfg: DeviceConfig) => void;
  onDisconnect?: () => void;
  onOpenFlashWizard?: () => void;
  /** When true, live polling is suspended (e.g. flash wizard open). */
  pollingPaused?: () => boolean;
}

export interface DashboardView {
  el: HTMLElement;
  unmount(): void;
  refreshConfig(config: DeviceConfig): void;
  pausePolling(): void;
  resumePolling(): void;
}

const TABS: Array<{ id: DashboardTab; label: string }> = [
  { id: "live", label: "Live Data" },
  { id: "network", label: "Network" },
  { id: "server", label: "Server" },
  { id: "hardware", label: "Hardware" },
  { id: "backup", label: "Backup" },
];

export function createDashboardView(opts: DashboardViewOptions): DashboardView {
  const el = document.createElement("section");
  el.className = "dashboard";
  el.setAttribute("aria-label", "Device dashboard");
  let active: DashboardTab = "live";
  let config: DeviceConfig = { ...opts.config };
  let live: LiveData | null = null;
  let timer: number | null = null;
  let livePolling = false;
  const formViews: Partial<Record<DashboardTab, FormView | { el: HTMLElement; refresh(): void }>> = {};

  function render(): void {
    el.innerHTML = `
      <div class="dashboard-toolbar">
        <div class="tabbar" role="tablist">
          ${TABS.map(
            (t) => `
            <button class="tab" role="tab" id="tab-${t.id}" aria-selected="${t.id === active}" data-tab="${t.id}" tabindex="${t.id === active ? 0 : -1}">
              ${t.label}
            </button>`
          ).join("")}
        </div>
        <button class="btn primary" id="flash-fw-btn" type="button" aria-label="Flash Firmware">⚡ Flash Firmware</button>
      </div>
      <div class="tab-panel" role="tabpanel" id="panel-${active}"></div>
    `;
    el.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab as DashboardTab));
      btn.addEventListener("keydown", (e) => onTabKey(e));
    });
    el.querySelector("#flash-fw-btn")?.addEventListener("click", () => {
      opts.onOpenFlashWizard?.();
    });
    renderPanel();
  }

  function onTabKey(e: KeyboardEvent): void {
    const tabs = Array.from(el.querySelectorAll<HTMLButtonElement>(".tab"));
    const idx = tabs.findIndex((t) => t.dataset.tab === active);
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else return;
    e.preventDefault();
    switchTab(tabs[next].dataset.tab as DashboardTab);
    tabs[next].focus();
  }

  function switchTab(tab: DashboardTab): void {
    active = tab;
    render();
  }

  function renderPanel(): void {
    const panel = el.querySelector(".tab-panel") as HTMLElement;
    panel.innerHTML = "";
    if (active === "live") {
      panel.appendChild(renderLive());
      startLivePolling();
    } else if (active === "network") {
      const v = formViews.network ?? createNetworkView(opts.portPath, config, (c) => {
        config = c;
        opts.onConfigChanged?.(c);
      });
      formViews.network = v;
      panel.appendChild(v.el);
      stopLivePolling();
    } else if (active === "server") {
      const v = formViews.server ?? createServerView(opts.portPath, config, (c) => {
        config = c;
        opts.onConfigChanged?.(c);
      });
      formViews.server = v;
      panel.appendChild(v.el);
      stopLivePolling();
    } else if (active === "hardware") {
      const v = formViews.hardware ?? createHardwareView(opts.portPath, config, (c) => {
        config = c;
        opts.onConfigChanged?.(c);
      });
      formViews.hardware = v;
      panel.appendChild(v.el);
      stopLivePolling();
    } else if (active === "backup") {
      const v = formViews.backup ?? createBackupView({
        portPath: opts.portPath,
        onImported: () => opts.onConfigChanged?.(config),
      });
      formViews.backup = v;
      panel.appendChild(v.el);
      stopLivePolling();
    }
  }

  function renderLive(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "live-grid";
    const l = live;
    wrap.innerHTML = `
      <article class="card gauge-card">
        <fm-gauge label="Battery" unit="V" min="0" max="15" precision="1" value="${l?.battery_v ?? 0}"></fm-gauge>
      </article>
      <article class="card gauge-card">
        <fm-gauge label="RSSI" unit="dBm" min="-120" max="-30" precision="0" value="${l?.rssi ?? -120}"></fm-gauge>
      </article>
      <article class="card gauge-card">
        <fm-gauge label="Satellites" min="0" max="20" precision="0" value="${l?.sat ?? 0}"></fm-gauge>
      </article>
      <article class="card gauge-card">
        <fm-gauge label="Speed" unit="km/h" min="0" max="200" precision="0" value="${l?.spd ?? 0}"></fm-gauge>
      </article>
      <article class="card live-detail">
        <h3>Telemetry</h3>
        <dl>
          <dt>VIN</dt><dd>${escapeText(l?.vin ?? "—")}</dd>
          <dt>Lat / Lng</dt><dd>${l ? `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}` : "—"}</dd>
          <dt>Altitude</dt><dd>${l ? `${l.alt.toFixed(1)} m` : "—"}</dd>
          <dt>Course</dt><dd>${l ? `${l.crs.toFixed(0)}°` : "—"}</dd>
          <dt>Uptime</dt><dd>${l ? formatUptime(l.uptime_ms) : "—"}</dd>
          <dt>Operator</dt><dd>${escapeText(l?.net_op ?? "—")}</dd>
          <dt>IP</dt><dd>${escapeText(l?.net_ip ?? "—")}</dd>
        </dl>
      </article>
    `;
    return wrap;
  }

  function startLivePolling(): void {
    if (livePolling) return;
    livePolling = true;
    void pollLive();
    // 3s cadence: each poll reopens the port and the firmware shares this serial
    // line, so polling too fast contends with the device's own output.
    timer = window.setInterval(() => void pollLive(), 3000);
  }

  function stopLivePolling(): void {
    livePolling = false;
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  /** Pause live polling (e.g. while the flash wizard is open). */
  function pausePolling(): void {
    stopLivePolling();
  }

  /** Resume live polling if currently on the live tab. */
  function resumePolling(): void {
    if (active === "live") startLivePolling();
  }

  async function pollLive(): Promise<void> {
    if (!livePolling) return;
    if (opts.pollingPaused && opts.pollingPaused()) {
      return;
    }
    try {
      live = await getLiveData(opts.portPath);
    } catch {
      live = null;
    }
    if (active === "live") {
      const panel = el.querySelector(".tab-panel") as HTMLElement | null;
      if (panel) {
        panel.innerHTML = "";
        panel.appendChild(renderLive());
      }
    }
  }

  function refreshConfig(cfg: DeviceConfig): void {
    config = { ...cfg };
    if (formViews.network) (formViews.network as FormView).refresh(config);
    if (formViews.server) (formViews.server as FormView).refresh(config);
    if (formViews.hardware) (formViews.hardware as FormView).refresh(config);
  }

  function unmount(): void {
    stopLivePolling();
  }

  render();
  return { el, unmount, refreshConfig, pausePolling, resumePolling };
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
