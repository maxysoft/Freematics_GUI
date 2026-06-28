// Flash Firmware wizard: a 4-step modal overlay.
//
// Steps:
//   1. Warning  — checkbox "I understand" gates Next.
//   2. Backup   — exportConfig(port, backupPath); Next disabled until done.
//   3. Flash    — flashFirmware(port) + listenFlashProgress; auto-advance.
//   4. Restore  — importConfig(port, backupPath); Done closes the wizard.
//
// Cancel is allowed on steps 1 and 2 only. The wizard is driven by a small
// state machine; views are pure re-renders off the current step + status.

import "../components/gauge";
import {
  exportConfig,
  importConfig,
  flashFirmware,
  type ImportOutcome,
} from "../lib/tauri";
import { listenFlashProgress, type FlashProgress } from "../lib/events";

export type WizardStep = 0 | 1 | 2 | 3;

export interface FlashWizardOptions {
  portPath: string;
  /** Override the backup path (tests). Defaults to a temp path. */
  backupPath?: string;
  /** Called when the wizard closes (Done or Cancel). */
  onClose: () => void;
  /** Called after restore completes so the caller can refresh config. */
  onRestored?: () => void;
}

export interface FlashWizardView {
  el: HTMLElement;
  unmount(): void;
}

const STEP_LABELS = ["Warning", "Backup", "Flash", "Restore"];

export function createFlashWizardView(
  opts: FlashWizardOptions
): FlashWizardView {
  const el = document.createElement("div");
  el.className = "wizard-overlay";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Flash Firmware");

  // Resolved lazily before the backup runs: a real OS temp path from the
  // backend in Tauri, or a /tmp fallback in browser/test. An explicit
  // opts.backupPath (tests) always wins.
  let backupPath = opts.backupPath ?? "";

  async function resolveBackupPath(): Promise<string> {
    if (backupPath) return backupPath;
    const native = tauriInvoke<string>("temp_backup_path");
    backupPath = native
      ? await native
      : `/tmp/freematics-backup-${Date.now()}.json`;
    return backupPath;
  }

  let step: WizardStep = 0;
  let acknowledged = false;
  let backupDone = false;
  let backupError: string | null = null;
  let backupSkipped = false;
  let flashProgress: FlashProgress | null = null;
  let flashError: string | null = null;
  let restoreDone = false;
  let restoreError: string | null = null;
  let closed = false;
  let unsubFlash: (() => void) | null = null;

  function render(): void {
    el.innerHTML = `
      <div class="wizard-card" role="document">
        <header class="wizard-head">
          <h2>Flash Firmware</h2>
          <ol class="wizard-steps" aria-label="Steps">
            ${STEP_LABELS.map(
              (label, i) => `
              <li class="wizard-step ${i === step ? "active" : ""} ${i < step ? "done" : ""}">
                <span class="step-idx">${i + 1}</span>
                <span class="step-label">${label}</span>
              </li>`
            ).join("")}
          </ol>
        </header>
        <div class="wizard-body" id="wizard-body">
          ${renderStep()}
        </div>
        <footer class="wizard-foot">
          ${renderFooter()}
        </footer>
      </div>
    `;
    wireControls();
  }

  function renderStep(): string {
    if (step === 0) {
      return `
        <div class="wizard-warn">
          <p class="warn-icon" aria-hidden="true">⚠</p>
          <p><strong>This will reflash your device firmware.</strong></p>
          <p class="muted">A backup of the current config will be saved and restored after flashing. Do not disconnect power or the USB cable during the process.</p>
          <label class="wizard-check">
            <input type="checkbox" id="ack-check" ${acknowledged ? "checked" : ""} />
            <span>I understand the risks and want to continue.</span>
          </label>
          ${backupError ? `<p class="err" role="alert">${escapeText(backupError)}</p>` : ""}
        </div>
      `;
    }
    if (step === 1) {
      return `
        <div class="wizard-backup">
          <p>Backing up current config to:</p>
          <p class="mono backup-path">${escapeText(backupPath)}</p>
          <p class="backup-status" role="status" aria-live="polite">
            ${backupDone ? "✓ Backup complete." : backupError ? escapeText(backupError) : "Click Next to start the backup."}
          </p>
          ${
            backupError
              ? `<p class="muted">Couldn't read the current config — this is expected if the patched firmware isn't on the device yet. You can flash without a backup, but the current config won't be restored afterwards.</p>`
              : ""
          }
        </div>
      `;
    }
    if (step === 2) {
      const pct = flashProgress?.percentage ?? 0;
      const stage = flashProgress?.stage ?? "Starting…";
      return `
        <div class="wizard-flash">
          <p>Flashing firmware…</p>
          <div class="progress-wrap" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
            <div class="progress-bar" id="flash-bar" style="width:${pct}%"></div>
          </div>
          <p class="progress-stage" id="flash-stage">${escapeText(stage)} — ${pct}%</p>
          ${flashError ? `<p class="err" role="alert">${escapeText(flashError)}</p>` : ""}
        </div>
      `;
    }
    // step === 3
    if (backupSkipped) {
      return `
        <div class="wizard-restore">
          <p class="restore-status" role="status" aria-live="polite">
            Backup was skipped — no config to restore. Configure the device from the dashboard after it reconnects.
          </p>
        </div>
      `;
    }
    return `
      <div class="wizard-restore">
        <p>Restoring config from:</p>
        <p class="mono backup-path">${escapeText(backupPath)}</p>
        <p class="restore-status" role="status" aria-live="polite">
          ${restoreDone ? "✓ Restore complete." : restoreError ? escapeText(restoreError) : "Click Next to restore the config."}
        </p>
      </div>
    `;
  }

  function renderFooter(): string {
    const cancelAllowed = step === 0 || step === 1;
    const cancelBtn = cancelAllowed
      ? `<button class="btn ghost" id="wizard-cancel" type="button">Cancel</button>`
      : `<button class="btn ghost" id="wizard-cancel" type="button" disabled>Cancel</button>`;

    if (step === 0) {
      return `${cancelBtn}<button class="btn primary" id="wizard-next" type="button" ${acknowledged ? "" : "disabled"}>Next</button>`;
    }
    if (step === 1) {
      if (backupDone) {
        return `${cancelBtn}<button class="btn primary" id="wizard-next" type="button">Next</button>`;
      }
      // Backup failed (e.g. no patched firmware yet): let the user flash anyway.
      if (backupError) {
        return `${cancelBtn}<button class="btn primary" id="wizard-skip-backup" type="button">Flash without backup</button>`;
      }
      return `${cancelBtn}<button class="btn primary" id="wizard-next" type="button" disabled>Next</button>`;
    }
    if (step === 2) {
      return `<button class="btn ghost" id="wizard-cancel" type="button" disabled>Cancel</button>`;
    }
    // step 3
    return `<button class="btn primary" id="wizard-done" type="button" ${restoreDone ? "" : "disabled"}>Done</button>`;
  }

  function wireControls(): void {
    el.querySelector("#ack-check")?.addEventListener("change", (e) => {
      acknowledged = (e.target as HTMLInputElement).checked;
      render();
    });
    el.querySelector("#wizard-cancel")?.addEventListener("click", () => {
      if (step === 0 || step === 1) close();
    });
    el.querySelector("#wizard-next")?.addEventListener("click", () => void onNext());
    el.querySelector("#wizard-skip-backup")?.addEventListener("click", () => {
      backupSkipped = true;
      step = 2;
      render();
      void runFlash();
    });
    el.querySelector("#wizard-done")?.addEventListener("click", () => {
      if (restoreDone) {
        opts.onRestored?.();
        close();
      }
    });
  }

  async function onNext(): Promise<void> {
    if (step === 0) {
      if (!acknowledged) return;
      step = 1;
      render();
      void runBackup();
      return;
    }
    if (step === 1) {
      if (!backupDone) return;
      step = 2;
      render();
      void runFlash();
      return;
    }
    if (step === 2) {
      // Flash auto-advances; ignore manual next.
      return;
    }
    if (step === 3) {
      if (!restoreDone) return;
    }
  }

  async function runBackup(): Promise<void> {
    backupError = null;
    render();
    try {
      const path = await resolveBackupPath();
      render();
      await exportConfig(opts.portPath, path);
      backupDone = true;
    } catch (err) {
      backupError = `Backup failed: ${String(err)}`;
      backupDone = false;
    }
    render();
  }

  async function runFlash(): Promise<void> {
    flashError = null;
    flashProgress = { percentage: 0, stage: "Starting…" };
    render();
    unsubFlash = listenFlashProgress((p) => {
      flashProgress = p;
      if (p.percentage >= 100) {
        flashProgress = { percentage: 100, stage: p.stage || "Complete" };
        render();
        finishFlash();
      } else {
        render();
      }
    });
    try {
      await flashFirmware(opts.portPath);
      // If backend did not emit a 100% event, treat completion as success.
      if (!closed && step === 2) {
        flashProgress = { percentage: 100, stage: "Complete" };
        render();
        finishFlash();
      }
    } catch (err) {
      if (closed) return;
      flashError = `Flash failed: ${String(err)}`;
      render();
    }
  }

  function finishFlash(): void {
    if (closed) return;
    if (unsubFlash) {
      unsubFlash();
      unsubFlash = null;
    }
    if (flashError) return;
    step = 3;
    render();
    void runRestore();
  }

  async function runRestore(): Promise<void> {
    restoreError = null;
    // Nothing was backed up — skip restore and let the user finish.
    if (backupSkipped) {
      restoreDone = true;
      render();
      return;
    }
    render();
    try {
      await importConfig(opts.portPath, backupPath);
      restoreDone = true;
    } catch (err) {
      restoreError = `Restore failed: ${String(err)}`;
      restoreDone = false;
    }
    render();
  }

  function close(): void {
    if (closed) return;
    closed = true;
    if (unsubFlash) {
      unsubFlash();
      unsubFlash = null;
    }
    opts.onClose();
  }

  function unmount(): void {
    close();
  }

  render();
  return { el, unmount };
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Invoke a Tauri command if the bridge is present, else null (browser/test).
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
