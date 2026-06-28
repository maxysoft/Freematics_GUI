// Shared helpers for config form views (network/server/hardware).
//
// Each form view renders <fm-field> elements bound to a DeviceConfig subset,
// validates on Apply, and calls setConfig with the merged config.

import "../components/form-field";
import { setConfig, type DeviceConfig } from "../lib/tauri";
import type { FmField } from "../components/form-field";

export interface FieldSpec {
  name: keyof DeviceConfig;
  label: string;
  type: "text" | "password" | "number" | "select" | "checkbox";
  help?: string;
  /** Longer explanation surfaced behind an "i" button next to the label. */
  desc?: string;
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
          <span class="form-status" role="status" aria-live="polite"></span>
        </div>
      </form>
    `;

    el.querySelectorAll<FmField>("fm-field").forEach((f) => {
      f.addEventListener("change", (e: Event) => {
        const detail = (e as CustomEvent).detail as { name: string; value: string | boolean };
        (working as Record<string, unknown>)[detail.name] = detail.value;
      });
    });

    el.querySelector("#cfg-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      void apply();
    });
  }

  async function apply(): Promise<void> {
    const status = el.querySelector(".form-status") as HTMLElement;
    // Validate.
    let firstError: { name: keyof DeviceConfig; msg: string } | null = null;
    for (const spec of opts.fields) {
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
      status.textContent = "Saved.";
      opts.onApplied?.(working);
    } catch (err) {
      status.textContent = `Error: ${String(err)}`;
    }
  }

  function refresh(config: DeviceConfig): void {
    working = { ...config };
    render();
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
