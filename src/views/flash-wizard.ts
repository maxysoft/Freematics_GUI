// Flash Firmware wizard: a 4-step modal overlay.
//
// Steps:
//   1. Warning  — pick firmware (bundled or a user .bin), ack gates Next.
//   2. Backup   — choose location + back up config (skippable, never a dead-end).
//   3. Flash    — flashFirmware(port, firmware) + listenFlashProgress.
//   4. Restore  — importConfig(port, backupPath) unless backup was skipped.
//
// Cancel is allowed on steps 1 and 2 only.

import "../components/gauge";
import {
  exportConfig,
  importConfig,
  flashFirmware,
  getFirmwareInfo,
  pickFirmwarePath,
  pickSavePath,
  type ImportOutcome,
} from "../lib/tauri";
import { listenFlashProgress, type FlashProgress } from "../lib/events";

export type WizardStep = 0 | 1 | 2 | 3;

export interface FlashWizardOptions {
  portPath: string;
  /** Override the backup path (tests). Defaults to a temp path. */
  backupPath?: string;
  /** First-run setup: skip the pre-flash backup (device has no firmware yet). */
  skipBackup?: boolean;
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

  // Resolved lazily before the backup runs; explicit opts.backupPath (tests) wins.
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
  let backupGen = 0; // generation token so a superseded backup can't clobber state
  let flashProgress: FlashProgress | null = null;
  let flashError: string | null = null;
  let restoreDone = false;
  let restoreError: string | null = null;
  let closed = false;
  let unsubFlash: (() => void) | null = null;

  // Firmware selection: null path = bundled image; otherwise a user .bin.
  let firmwarePath: string | null = null;
  let firmwareLabel = "bundled patched firmware";
  let firmwareAvailable = true; // is a flashable firmware available?

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
      const fwReady = firmwareAvailable || firmwarePath !== null;
      const fwText = firmwarePath
        ? firmwareLabel
        : firmwareAvailable
          ? firmwareLabel
          : "No firmware loaded — choose a .bin file to flash.";
      return `
        <div class="wizard-warn">
          <p class="warn-icon" aria-hidden="true">⚠</p>
          <p><strong>This will reflash your device firmware.</strong></p>
          <p class="muted">${
            opts.skipBackup
              ? "This device has no readable config yet, so it will be flashed directly. "
              : "A backup of the current config will be saved and restored after flashing. "
          }Do not disconnect power or the USB cable during the process.</p>
          <div class="wizard-fw">
            <span class="fw-label">Firmware:</span>
            <span class="fw-value ${fwReady ? "" : "err"}">${escapeText(fwText)}</span>
            ${
              isTauri()
                ? `<button class="btn ghost" id="wizard-pick-fw" type="button">Choose .bin…</button>`
                : ""
            }
          </div>
          <label class="wizard-check">
            <input type="checkbox" id="ack-check" ${acknowledged ? "checked" : ""} />
            <span>I understand the risks and want to continue.</span>
          </label>
        </div>
      `;
    }
    if (step === 1) {
      return `
        <div class="wizard-backup">
          <p>Backing up current config to:</p>
          <p class="mono backup-path">${escapeText(backupPath || "(choosing location…)")}</p>
          ${
            isTauri()
              ? `<button class="btn ghost" id="wizard-pick-backup" type="button">Change location…</button>`
              : ""
          }
          <p class="backup-status" role="status" aria-live="polite">
            ${backupDone ? "✓ Backup complete." : backupError ? escapeText(backupError) : "Backing up…"}
          </p>
          ${
            backupError
              ? `<p class="muted">Couldn't read the current config — expected if the patched firmware isn't on the device yet. Change the location, retry, or skip (you can set the device up fresh after flashing).</p>`
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
          ${restoreDone ? "✓ Restore complete." : restoreError ? escapeText(restoreError) : "Restoring config…"}
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
      const fwReady = firmwareAvailable || firmwarePath !== null;
      return `${cancelBtn}<button class="btn primary" id="wizard-next" type="button" ${acknowledged && fwReady ? "" : "disabled"}>Next</button>`;
    }
    if (step === 1) {
      // Offer "Skip backup" until a good backup exists so the user is never
      // stuck — but once it succeeds, don't tempt them to discard it (Next
      // routes through restore).
      const skipBtn = backupDone
        ? ""
        : `<button class="btn ghost" id="wizard-skip-backup" type="button">Skip backup</button>`;
      return `${cancelBtn}${skipBtn}<button class="btn primary" id="wizard-next" type="button" ${backupDone ? "" : "disabled"}>Next</button>`;
    }
    if (step === 2) {
      return `<button class="btn ghost" id="wizard-cancel" type="button" disabled>Cancel</button>`;
    }
    // step 3 — never a dead-end: on restore failure offer Retry + Finish anyway
    // (the device is already flashed, so the user must always be able to exit).
    if (restoreError) {
      return `<button class="btn ghost" id="wizard-retry-restore" type="button">Retry restore</button><button class="btn primary" id="wizard-done" type="button">Finish anyway</button>`;
    }
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
    el.querySelector("#wizard-pick-fw")?.addEventListener("click", () => void onPickFirmware());
    el.querySelector("#wizard-pick-backup")?.addEventListener("click", () => void onPickBackup());
    el.querySelector("#wizard-retry-restore")?.addEventListener("click", () => {
      restoreError = null;
      render();
      void runRestore();
    });
    el.querySelector("#wizard-done")?.addEventListener("click", () => {
      // Rendered enabled only when restore succeeded, or failed ("Finish
      // anyway"); either way let the caller refresh/reconnect, then close.
      opts.onRestored?.();
      close();
    });
  }

  async function onNext(): Promise<void> {
    if (step === 0) {
      if (!acknowledged) return;
      // First-run setup: no firmware to back up — go straight to flashing.
      if (opts.skipBackup) {
        backupSkipped = true;
        step = 2;
        render();
        void runFlash();
        return;
      }
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

  async function onPickFirmware(): Promise<void> {
    if (!isTauri()) return;
    try {
      const p = await pickFirmwarePath();
      if (p) {
        firmwarePath = p;
        firmwareLabel = baseName(p);
        firmwareAvailable = true;
        render();
      }
    } catch {
      /* dialog cancelled / unavailable — ignore */
    }
  }

  async function onPickBackup(): Promise<void> {
    if (!isTauri()) return;
    try {
      const p = await pickSavePath("freematics-backup.json");
      if (p) {
        backupPath = p;
        backupDone = false;
        render();
        void runBackup();
      }
    } catch {
      /* ignore */
    }
  }

  async function runBackup(): Promise<void> {
    // Generation token: if a newer backup starts (e.g. "Change location…"),
    // this run's results are discarded so it can't clobber the current state.
    const gen = ++backupGen;
    backupError = null;
    backupDone = false;
    render();
    try {
      const path = await resolveBackupPath();
      if (gen !== backupGen) return;
      render();
      await exportConfig(opts.portPath, path);
      if (gen !== backupGen) return;
      backupDone = true;
    } catch (err) {
      if (gen !== backupGen) return;
      backupError = `Backup failed: ${String(err)} — change the location, retry, or skip.`;
      backupDone = false;
    }
    if (gen === backupGen) render();
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
        // Update the bar/label in place — a full render() on every progress
        // tick rebuilds the whole card and makes the screen flicker.
        updateFlashProgress();
      }
    });
    try {
      await flashFirmware(opts.portPath, firmwarePath);
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

  // In-place progress update (no innerHTML rebuild) to avoid flicker on each
  // flash://progress tick. Falls back to a full render if the bar isn't mounted.
  function updateFlashProgress(): void {
    if (step !== 2) return;
    const pct = flashProgress?.percentage ?? 0;
    const stage = flashProgress?.stage ?? "Starting…";
    const bar = el.querySelector("#flash-bar") as HTMLElement | null;
    if (!bar) {
      render();
      return;
    }
    bar.style.width = `${pct}%`;
    el.querySelector(".progress-wrap")?.setAttribute("aria-valuenow", String(pct));
    const label = el.querySelector("#flash-stage");
    if (label) label.textContent = `${stage} — ${pct}%`;
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

  // Best-effort: show which bundled firmware will be flashed, or flag if none.
  async function loadFirmwareInfo(): Promise<void> {
    if (!isTauri()) return;
    try {
      const info = await getFirmwareInfo();
      // Don't clobber a firmware the user already picked while this was loading.
      if (firmwarePath === null) {
        firmwareLabel = `${info.binary}${info.version ? ` (v${info.version})` : ""}`;
        firmwareAvailable = true;
      }
    } catch {
      if (firmwarePath === null) {
        firmwareAvailable = false;
        firmwareLabel = "no bundled firmware found";
      }
    }
    if (step === 0) render();
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
  void loadFirmwareInfo();
  return { el, unmount };
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function baseName(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function isTauri(): boolean {
  return !!(window as unknown as { __TAURI__?: unknown }).__TAURI__;
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
