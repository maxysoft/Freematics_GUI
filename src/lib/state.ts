// Minimal observable app state store. No framework.
//
// Holds the active port, connection flag, current config snapshot, and the
// latest live-data sample. Views subscribe via `onChange` and read the
// current snapshot via the getters.

import type { DeviceConfig, LiveData } from "./tauri";

export interface StateSnapshot {
  portPath: string | null;
  connected: boolean;
  config: DeviceConfig | null;
  liveData: LiveData | null;
  view: AppView;
  flashWizardOpen: boolean;
  backupPath: string | null;
}

export type AppView = "connect" | "dashboard";
export type DashboardTab = "live" | "network" | "server" | "hardware" | "backup";

export type StateListener = (snapshot: StateSnapshot) => void;

export class AppState {
  private portPath: string | null = null;
  private connected = false;
  private config: DeviceConfig | null = null;
  private liveData: LiveData | null = null;
  private view: AppView = "connect";
  private tab: DashboardTab = "live";
  private flashWizardOpen = false;
  private backupPath: string | null = null;
  private listeners = new Set<StateListener>();

  get snapshot(): StateSnapshot {
    return {
      portPath: this.portPath,
      connected: this.connected,
      config: this.config,
      liveData: this.liveData,
      view: this.view,
      flashWizardOpen: this.flashWizardOpen,
      backupPath: this.backupPath,
    };
  }

  get currentPort(): string | null {
    return this.portPath;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get currentConfig(): DeviceConfig | null {
    return this.config;
  }

  get currentLiveData(): LiveData | null {
    return this.liveData;
  }

  get currentView(): AppView {
    return this.view;
  }

  get currentTab(): DashboardTab {
    return this.tab;
  }

  get isFlashWizardOpen(): boolean {
    return this.flashWizardOpen;
  }

  get currentBackupPath(): string | null {
    return this.backupPath;
  }

  onChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connect(portPath: string, config: DeviceConfig | null = null): void {
    this.portPath = portPath;
    this.connected = true;
    this.config = config;
    this.view = "dashboard";
    this.tab = "live";
    this.emit();
  }

  disconnect(): void {
    this.portPath = null;
    this.connected = false;
    this.config = null;
    this.liveData = null;
    this.view = "connect";
    this.emit();
  }

  setConfig(config: DeviceConfig): void {
    this.config = config;
    this.emit();
  }

  setLiveData(data: LiveData): void {
    this.liveData = data;
    this.emit();
  }

  setView(view: AppView): void {
    this.view = view;
    this.emit();
  }

  setTab(tab: DashboardTab): void {
    this.tab = tab;
    this.emit();
  }

  openFlashWizard(backupPath: string | null = null): void {
    this.flashWizardOpen = true;
    this.backupPath = backupPath;
    this.emit();
  }

  closeFlashWizard(): void {
    this.flashWizardOpen = false;
    this.backupPath = null;
    this.emit();
  }

  private emit(): void {
    const snap = this.snapshot;
    for (const l of this.listeners) l(snap);
  }
}

export const appState = new AppState();
