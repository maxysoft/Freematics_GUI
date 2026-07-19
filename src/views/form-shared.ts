// Shared helpers for config form views (network/server/hardware).
//
// Each form view renders <fm-field> elements bound to a DeviceConfig subset,
// validates on Apply, and calls setConfig with the merged config.

import "../components/form-field";
import { setConfig, rebootDevice, type DeviceConfig } from "../lib/tauri";
import type { FmField } from "../components/form-field";

export interface FieldSpec {
  name: keyof DeviceConfig;
  label: string;
  type: "text" | "password" | "number" | "select" | "checkbox";
  help?: string;
  /** Longer explanation surfaced behind an "i" button next to the label. */
  desc?: string;
  /**
   * Field maps to a firmware compile-time #define the device can't change at
   * runtime (e.g. server protocol, storage, OBD/MEMS toggles). Rendered
   * disabled with a lock note so the UI doesn't imply it's settable.
   */
  readonly?: boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  options?: Array<[string, string]>;
}

export type Validator = (value: string | boolean, cfg: Partial<DeviceConfig>) => string | null;

export interface FormViewOptions {
  portPath: string;
  config: DeviceConfig;
  fields: FieldSpec[];
  validators?: Partial<Record<keyof DeviceConfig, Validator>>;
  onApplied?: (cfg: DeviceConfig) => void;
  title: string;
}

export interface FormView {
  el: HTMLElement;
  refresh(config: DeviceConfig): void;
}

export function createFormView(opts: FormViewOptions): FormView {
  const el = document.createElement("section");
  el.className = "form-view";
  el.setAttribute("aria-label", opts.title);
  let working: DeviceConfig = { ...opts.config };

  function fieldEl(name: keyof DeviceConfig): FmField | null {
    return el.querySelector(`fm-field[name="${String(name)}"]`) as FmField | null;
  }

  function render(): void {
    const fields = opts.fields
      .map((spec) => {
        const val = working[spec.name];
        const attrs: string[] = [
          `name="${spec.name}"`,
          `label="${escapeAttr(spec.label)}"`,
          `type="${spec.type}"`,
        ];
        if (spec.help) attrs.push(`help="${escapeAttr(spec.help)}"`);
        if (spec.desc) attrs.push(`desc="${escapeAttr(spec.desc)}"`);
        if (spec.readonly) attrs.push(`readonly`);
        if (spec.placeholder) attrs.push(`placeholder="${escapeAttr(spec.placeholder)}"`);
        if (spec.type === "number") {
          if (spec.min !== undefined) attrs.push(`min="${spec.min}"`);
          if (spec.max !== undefined) attrs.push(`max="${spec.max}"`);
          attrs.push(`step="${spec.step ?? 1}"`);
        }
        if (spec.options) attrs.push(`options='${JSON.stringify(spec.options)}'`);
        const v = spec.type === "checkbox" ? (val ? "true" : "false") : String(val ?? "");
        attrs.push(`value="${escapeAttr(v)}"`);
        return `<fm-field ${attrs.join(" ")}></fm-field>`;
      })
      .join("");

    el.innerHTML = `
      <header class="view-head"><h2>${escapeText(opts.title)}</h2></header>
      <form class="form-grid" id="cfg-form">${fields}
        <div class="form-actions">
          <button class="btn primary" type="submit">Apply</button>
          <button class="btn ghost" type="button" id="restart-btn" hidden>Restart device now</button>
          <span class="form-status" role="status" aria-live="polite"></span>
        </div>
      </form>
    `;

    el.querySelectorAll<FmField>("fm-field").forEach((f) => {
      f.addEventListener("change", (e: Event) => {
        const detail = (e as CustomEvent).detail as { name: string; value: string | boolean };
        (working as Record<string, unknown>)[detail.name] = coerceValue(detail.name, detail.value);
      });
    });

    el.querySelector("#cfg-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      void apply();
    });

    el.querySelector("#restart-btn")?.addEventListener("click", () => void restart());
  }

  // The firmware applies the stored config once at boot, so saved changes
  // take effect on the next restart. Offered after a successful Apply.
  async function restart(): Promise<void> {
    const status = el.querySelector(".form-status") as HTMLElement;
    const btn = el.querySelector("#restart-btn") as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    status.textContent = "Restarting device…";
    try {
      await rebootDevice(opts.portPath);
      // Give the device time to boot before implying it's usable again.
      await new Promise((r) => setTimeout(r, 4000));
      status.textContent = "Device restarted — settings are now active.";
      if (btn) btn.hidden = true;
    } catch (err) {
      status.textContent = `Restart failed: ${String(err)}`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function apply(): Promise<void> {
    const status = el.querySelector(".form-status") as HTMLElement;
    // Validate.
    let firstError: { name: keyof DeviceConfig; msg: string } | null = null;
    for (const spec of opts.fields) {
      // Read-only fields can't be edited, so their loaded value is whatever the
      // device reported — never block Apply on it.
      if (spec.readonly) continue;
      const validator = opts.validators?.[spec.name];
      const field = fieldEl(spec.name);
      field?.setAttribute("error", "");
      if (validator) {
        const msg = validator(working[spec.name], working);
        if (msg) {
          field?.setAttribute("error", msg);
          if (!firstError) firstError = { name: spec.name, msg };
        }
      }
    }
    if (firstError) {
      status.textContent = `Fix errors before applying (${String(firstError.name)}).`;
      return;
    }
    status.textContent = "Applying…";
    try {
      await setConfig(opts.portPath, working);
      status.textContent = "Saved — takes effect after a device restart.";
      const btn = el.querySelector("#restart-btn") as HTMLButtonElement | null;
      if (btn) btn.hidden = false;
      opts.onApplied?.(working);
    } catch (err) {
      status.textContent = `Error: ${String(err)}`;
    }
  }

  function refresh(config: DeviceConfig): void {
    working = { ...config };
    render();
  }

  // <fm-field> emits string values for text/number/select inputs. The Rust
  // DeviceConfig has numeric types (i32/u16/f32) for number fields, so a raw
  // string like "80" fails serde deserialization ("invalid type: string,
  // expected i32"). Coerce number fields to JS numbers here; leave everything
  // else (text/select strings, checkbox booleans) as-is. A non-finite parse
  // falls back to the string so the field's validator can surface the error.
  function coerceValue(
    name: string,
    value: string | boolean
  ): string | number | boolean {
    if (typeof value !== "string") return value;
    const spec = opts.fields.find((s) => s.name === name);
    if (spec?.type !== "number") return value;
    const n = Number(value);
    return value.trim() !== "" && Number.isFinite(n) ? n : value;
  }

  render();
  return { el, refresh };
}

export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}
