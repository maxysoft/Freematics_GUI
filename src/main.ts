// App shell: header (title + connection status + disconnect), main renders the
// active view (connect or dashboard) based on app state.

import "./styles.css";
import "./components/gauge";
import "./components/form-field";
import { appState } from "./lib/state";
import { getConfig } from "./lib/tauri";
import { createConnectView, connectAndLoadConfig, type ConnectView } from "./views/connect";
import { createDashboardView, type DashboardView } from "./views/dashboard";
import { createFlashWizardView, type FlashWizardView } from "./views/flash-wizard";

const root = document.querySelector<HTMLElement>("#app");

let connectView: ConnectView | null = null;
let dashboardView: DashboardView | null = null;
let flashWizardView: FlashWizardView | null = null;

function renderHeader(): HTMLElement {
  const header = document.createElement("header");
  header.className = "app-header";
  const connected = appState.isConnected;
  const port = appState.currentPort ?? "—";
  header.innerHTML = `
    <div class="brand">
      <span class="logo" aria-hidden="true">◆</span>
      <h1>Freematics Config Manager</h1>
    </div>
    <div class="conn-status" role="status" aria-live="polite">
      <span class="dot ${connected ? "on" : "off"}" aria-hidden="true"></span>
      <span class="conn-text">${connected ? `Connected · ${escapeText(port)}` : "Disconnected"}</span>
      ${connected ? '<button class="btn ghost" id="disconnect-btn" type="button">Disconnect</button>' : ""}
    </div>
  `;
  header.querySelector("#disconnect-btn")?.addEventListener("click", () => {
    appState.disconnect();
  });
  return header;
}

function render(): void {
  if (!root) return;
  root.innerHTML = "";
  root.appendChild(renderHeader());
  const main = document.createElement("main");
  main.className = "app-main";

  if (appState.currentView === "connect") {
    connectView = createConnectView({
      onConnect: (portPath) => void onConnect(portPath),
    });
    main.appendChild(connectView.el);
    connectView.mount();
  } else if (appState.currentView === "dashboard") {
    const port = appState.currentPort;
    const config = appState.currentConfig;
    if (port && config) {
      dashboardView = createDashboardView({
        portPath: port,
        config,
        onConfigChanged: (c) => appState.setConfig(c),
        onDisconnect: () => appState.disconnect(),
        onOpenFlashWizard: () => appState.openFlashWizard(),
        pollingPaused: () => appState.isFlashWizardOpen,
      });
      main.appendChild(dashboardView.el);
    } else {
      main.innerHTML = '<p class="empty">No device connected.</p>';
    }
  }
  root.appendChild(main);

  if (appState.isFlashWizardOpen && appState.currentPort) {
    dashboardView?.pausePolling();
    // Wizard opened while NOT connected = first-run setup (device has no
    // firmware): skip the doomed pre-flash backup and, once flashed, connect.
    const setupMode = !appState.isConnected;
    const setupPort = appState.currentPort;
    flashWizardView = createFlashWizardView({
      portPath: setupPort,
      backupPath: appState.currentBackupPath ?? undefined,
      skipBackup: setupMode,
      onClose: () => {
        flashWizardView = null;
        appState.closeFlashWizard();
      },
      onRestored: () => {
        if (setupMode) {
          // Firmware just flashed; the device reboots into it — connect now.
          appState.closeFlashWizard();
          void onConnect(setupPort);
        } else {
          void refreshConfigAfterRestore();
        }
      },
    });
    root.appendChild(flashWizardView.el);
  }
}

async function refreshConfigAfterRestore(): Promise<void> {
  const port = appState.currentPort;
  if (!port) return;
  try {
    const cfg = await getConfig(port);
    appState.setConfig(cfg);
  } catch {
    /* ignore — config refresh best-effort */
  }
}

async function onConnect(portPath: string): Promise<void> {
  const { config, error } = await connectAndLoadConfig(portPath);
  if (config) {
    appState.connect(portPath, config);
  } else {
    const status = connectView?.el.querySelector(".connect-actions");
    if (status) {
      status.querySelector(".connect-error-block")?.remove();
      const block = document.createElement("div");
      block.className = "connect-error-block";

      const note = document.createElement("p");
      note.className = "err";
      note.setAttribute("role", "alert");
      // Include the real backend reason so beta testers can report it; full
      // detail also goes to the log file (see tauri-plugin-log).
      note.textContent = error
        ? `Couldn't read config from ${portPath}: ${error}`
        : `Couldn't read config from ${portPath}.`;

      const hint = document.createElement("p");
      hint.className = "muted";
      hint.textContent =
        "New device? It likely needs the Freematics Config Manager firmware. Set it up below — this flashes the firmware, then opens the configurator. No other software required.";

      const setupBtn = document.createElement("button");
      setupBtn.className = "btn primary";
      setupBtn.type = "button";
      setupBtn.textContent = "Set up device (flash firmware)";
      setupBtn.addEventListener("click", () => appState.beginSetup(portPath));

      block.append(note, hint, setupBtn);
      status.appendChild(block);
    }
  }
}

appState.onChange(() => {
  if (connectView) {
    connectView.unmount();
    connectView = null;
  }
  if (dashboardView) {
    dashboardView.unmount();
    dashboardView = null;
  }
  if (flashWizardView) {
    flashWizardView.unmount();
    flashWizardView = null;
  }
  render();
  if (!appState.isFlashWizardOpen && dashboardView) {
    dashboardView.resumePolling();
  }
});

render();

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function greet(): string {
  return "hello";
}
