// Backup view: Export button (exportConfig), Import button (file open + confirm +
// progress), firmware info display, warnings on import.
//
// Uses Tauri dialog plugin via invoke when available; falls back to a hidden
// <input type=file> for the import path in test/browser contexts.

import {
  exportConfig,
  importConfig,
  getFirmwareInfo,
  importWarnings,
  type FirmwareInfo,
  type ImportOutcome,
} from "../lib/tauri";

export interface BackupViewOptions {
  portPath: string;
  onImported?: () => void;
}

export interface BackupView {
  el: HTMLElement;
  refresh(): void;
}

export function createBackupView(opts: BackupViewOptions): BackupView {
  const el = document.createElement("section");
  el.className = "backup-view";
  el.setAttribute("aria-label", "Backup & Restore");
  let firmware: FirmwareInfo | null = null;

  async function loadFirmware(): Promise<void> {
    try {
      firmware = await getFirmwareInfo();
    } catch {
      firmware = null;
    }
    render();
  }

  function render(): void {
    const fw = firmware
      ? `
      <article class="card firmware-info">
        <h3>Firmware</h3>
        <dl>
          <dt>Version</dt><dd>${escapeText(firmware.version || "—")}</dd>
          <dt>SHA-256</dt><dd class="mono">${escapeText(firmware.sha256 || "—")}</dd>
          <dt>Binary</dt><dd>${escapeText(firmware.binary || "—")}</dd>
          <dt>Built from</dt><dd>${escapeText(firmware.built_from_commit || "—")}</dd>
        </dl>
      </article>`
      : `<article class="card"><p class="muted">Loading firmware info…</p></article>`;

    el.innerHTML = `
      <header class="view-head"><h2>Backup & Restore</h2></header>
      <div class="backup-grid">
        <article class="card">
          <h3>Export</h3>
          <p class="muted">Save the current device config as a JSON backup file.</p>
          <button class="btn primary" id="export-btn" type="button">Export Config…</button>
          <span class="backup-status" role="status" aria-live="polite"></span>
        </article>
        <article class="card">
          <h3>Import</h3>
          <p class="muted">Restore config from a JSON backup. Existing config will be overwritten.</p>
          <button class="btn" id="import-btn" type="button">Import Config…</button>
          <input type="file" id="import-file" accept=".json,application/json" hidden />
          <div class="import-progress" hidden>
            <progress id="import-bar" value="0" max="100"></progress>
            <span id="import-pct">0%</span>
          </div>
          <ul class="warnings" id="import-warnings" role="alert"></ul>
        </article>
        ${fw}
      </div>
    `;

    el.querySelector("#export-btn")?.addEventListener("click", () => void onExport());
    el.querySelector("#import-btn")?.addEventListener("click", () => onImportClick());
    el.querySelector("#import-file")?.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.files && input.files[0]) void onImportConfirm(input.files[0]);
    });
  }

  async function onExport(): Promise<void> {
    const status = el.querySelector(".backup-status") as HTMLElement;
    status.textContent = "Preparing export…";
    try {
      const savePath = await pickSavePath();
      if (!savePath) {
        status.textContent = "Export cancelled.";
        return;
      }
      await exportConfig(opts.portPath, savePath);
      status.textContent = `Exported to ${savePath}`;
    } catch (err) {
      status.textContent = `Export failed: ${String(err)}`;
    }
  }

  function onImportClick(): void {
    // In Tauri, pick a real filesystem path via the native dialog so the
    // backend can read the exact file the user chose. In browser/test, fall
    // back to a hidden <input type=file>.
    const native = tauriInvoke<string | null>("pick_open_path");
    if (native) {
      void native.then((path) => {
        if (path) void onImportConfirm(baseName(path), path);
      });
      return;
    }
    const fileInput = el.querySelector("#import-file") as HTMLInputElement;
    fileInput.value = "";
    fileInput.click();
  }

  // `file` is used for the browser/test flow (path derived from its name);
  // `path` is the real filesystem path supplied by the native dialog flow.
  async function onImportConfirm(
    file: File | string,
    path?: string
  ): Promise<void> {
    const name = typeof file === "string" ? file : file.name;
    const confirmed = window.confirm(
      `Import config from "${name}"? This will overwrite the current device config.`
    );
    if (!confirmed) return;
    const progressWrap = el.querySelector(".import-progress") as HTMLElement;
    const bar = el.querySelector("#import-bar") as HTMLProgressElement;
    const pct = el.querySelector("#import-pct") as HTMLElement;
    const warningsList = el.querySelector("#import-warnings") as HTMLUListElement;
    warningsList.innerHTML = "";
    progressWrap.hidden = false;
    bar.value = 10;
    pct.textContent = "10%";
    try {
      const loadPath =
        path ?? (await stashFile(file as File));
      bar.value = 50;
      pct.textContent = "50%";
      const outcome: ImportOutcome = await importConfig(opts.portPath, loadPath);
      bar.value = 100;
      pct.textContent = "100%";
      const warns = importWarnings(outcome);
      if (warns.length > 0) {
        warningsList.innerHTML = warns
          .map((w) => `<li>${escapeText(w)}</li>`)
          .join("");
      } else {
        warningsList.innerHTML = `<li class="ok">Import complete.</li>`;
      }
      opts.onImported?.();
    } catch (err) {
      warningsList.innerHTML = `<li class="err">Import failed: ${escapeText(String(err))}</li>`;
      progressWrap.hidden = true;
    }
  }

  function refresh(): void {
    void loadFirmware();
  }

  void loadFirmware();
  return { el, refresh };
}

// Invoke a Tauri command if the bridge is present, else return null so callers
// can use a browser fallback. Avoids importing from lib/tauri (which throws when
// the global is absent, e.g. in unit tests).
function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> | null {
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke<R>(c: string, a?: Record<string, unknown>): Promise<R> } };
  };
  const inv = w.__TAURI__?.core?.invoke;
  return inv ? inv<T>(cmd, args) : null;
}

function baseName(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

// In Tauri, open the native save dialog for a real path. In browser/test,
// prompt for a filename under /tmp.
async function pickSavePath(): Promise<string | null> {
  const native = tauriInvoke<string | null>("pick_save_path", {
    defaultName: "freematics-backup.json",
  });
  if (native) return await native;
  const name = window.prompt("Save backup as:", "freematics-backup.json");
  return name ? `/tmp/${name}` : null;
}

// Browser/test fallback only: a webview <input type=file> exposes no real
// filesystem path, so derive a temp path from the name. The native flow uses
// pick_open_path instead and never reaches this.
async function stashFile(file: File): Promise<string> {
  return `/tmp/${file.name}`;
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
