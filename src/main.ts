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
      onSetup: (portPath) => appState.beginSetup(portPath),
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
        // Quiet update: the form views already show the applied values; the
        // emitting setConfig would rebuild the whole dashboard and destroy
        // the post-Apply "Restart device now" affordance.
        onConfigChanged: (c) => appState.setConfigQuiet(c),
        onDisconnect: () => appState.disconnect(),
        onOpenFlashWizard: () => appState.openFlashWizard(),
        pollingPaused: () => appState.isFlashWizardOpen || appState.deviceRestarting,
      });
      main.appendChild(dashboardView.el);
    } else {
      main.innerHTML = '<p class="empty">No device connected.</p>';
    }
  }
  root.appendChild(main);

  const footer = document.createElement("footer");
  footer.className = "app-footer";
  footer.innerHTML = `<span>🤖 Made using AI</span>`;
  root.appendChild(footer);

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
  connectView?.setConnecting(portPath);
  const { config, error } = await connectAndLoadConfig(portPath);
  if (config) {
    appState.connect(portPath, config);
  } else {
    // Render the failure as connect-view state so the 2s device refresh can't
    // wipe it; the "Set up device" action is wired via the onSetup option. The
    // real backend reason is shown here and logged to the file.
    connectView?.setConnecting(null);
    connectView?.setError({ port: portPath, message: error ?? "" });
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
