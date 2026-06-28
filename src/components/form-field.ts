// <fm-field> custom element: label + input + help + error.
//
// Attributes: name, label, type (text|password|number|select|checkbox), help,
// error, value, placeholder, min, max, step, options (JSON for select).
// Emits "change" event with { name, value } detail. Sets aria-invalid on error.

export interface FieldChangeEvent {
  name: string;
  value: string | boolean;
}

export class FmField extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["label", "type", "help", "error", "value", "placeholder", "options", "name"];
  }

  private get dom(): HTMLElement {
    return this;
  }

  private connected = false;

  constructor() {
    super();
  }

  connectedCallback(): void {
    this.connected = true;
    this.render();
  }

  disconnectedCallback(): void {
    this.connected = false;
  }

  private get type(): string {
    return this.getAttribute("type") ?? "text";
  }

  private get name(): string {
    return this.getAttribute("name") ?? "";
  }

  private get options(): Array<[string, string]> {
    const raw = this.getAttribute("options");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((o) =>
        Array.isArray(o) ? [String(o[0]), String(o[1])] : [String(o), String(o)]
      ) as Array<[string, string]>;
    } catch {
      return [];
    }
  }

  private render(): void {
    const label = this.getAttribute("label") ?? "";
    const help = this.getAttribute("help") ?? "";
    const error = this.getAttribute("error") ?? "";
    const placeholder = this.getAttribute("placeholder") ?? "";
    const value = this.getAttribute("value") ?? "";
    const type = this.type;
    const name = this.name;
    const id = `fm-${name || Math.random().toString(36).slice(2)}`;
    const ariaInvalid = error ? "true" : "false";

    let control = "";
    if (type === "select") {
      const opts = this.options
        .map(
          ([v, l]) =>
            `<option value="${escapeAttr(v)}" ${v === value ? "selected" : ""}>${escapeText(l)}</option>`
        )
        .join("");
      control = `<select id="${id}" name="${escapeAttr(name)}" aria-invalid="${ariaInvalid}">${opts}</select>`;
    } else if (type === "checkbox") {
      const checked = value === "true" || value === "1";
      control = `<input id="${id}" name="${escapeAttr(name)}" type="checkbox" ${checked ? "checked" : ""} aria-invalid="${ariaInvalid}" />`;
    } else {
      const extra =
        type === "number"
          ? `min="${escapeAttr(this.getAttribute("min") ?? "")}" max="${escapeAttr(this.getAttribute("max") ?? "")}" step="${escapeAttr(this.getAttribute("step") ?? "1")}"`
          : "";
      control = `<input id="${id}" name="${escapeAttr(name)}" type="${escapeAttr(type)}" value="${escapeAttr(value)}" placeholder="${escapeAttr(placeholder)}" ${extra} aria-invalid="${ariaInvalid}" />`;
    }

    this.dom.innerHTML = `
      <style>
        :host { display: block; font-family: inherit; }
        .row { display: flex; flex-direction: column; gap: 0.25rem; }
        .row.check { flex-direction: row; align-items: center; gap: 0.5rem; }
        label { font-size: 0.8rem; color: var(--fm-muted, #9aa0a6); font-weight: 500; }
        input, select { background: var(--fm-input-bg, #2a2a2a); color: var(--fm-text, #e0e0e0); border: 1px solid var(--fm-border, #3a3a3a); border-radius: 4px; padding: 0.4rem 0.5rem; font-size: 0.9rem; font-family: inherit; }
        input:focus, select:focus { outline: 2px solid var(--fm-accent, #4a9eff); outline-offset: 1px; }
        input[aria-invalid="true"], select[aria-invalid="true"] { border-color: var(--fm-danger, #ff5a5a); }
        .help { font-size: 0.72rem; color: var(--fm-muted, #9aa0a6); }
        .error { font-size: 0.72rem; color: var(--fm-danger, #ff5a5a); }
      </style>
      <div class="row ${type === "checkbox" ? "check" : ""}">
        <label for="${id}">${escapeText(label)}</label>
        ${control}
        ${help ? `<span class="help">${escapeText(help)}</span>` : ""}
        ${error ? `<span class="error" role="alert">${escapeText(error)}</span>` : ""}
      </div>
    `;

    const input = this.dom.querySelector("input, select") as
      | HTMLInputElement
      | HTMLSelectElement
      | null;
    if (input) {
      input.addEventListener("change", (e: Event) => {
        e.stopPropagation();
        const v =
          input instanceof HTMLInputElement && input.type === "checkbox"
            ? input.checked
            : input.value;
        this.dispatchEvent(
          new CustomEvent<FieldChangeEvent>("change", {
            detail: { name, value: v },
            bubbles: true,
          })
        );
      });
    }
  }

  attributeChangedCallback(): void {
    if (!this.connected) return;
    this.render();
  }

  setValue(v: string | boolean): void {
    const input = this.dom.querySelector("input, select") as
      | HTMLInputElement
      | HTMLSelectElement
      | null;
    if (!input) return;
    if (input instanceof HTMLInputElement && input.type === "checkbox") {
      input.checked = Boolean(v);
    } else {
      input.value = String(v);
    }
  }

  getValue(): string | boolean {
    const input = this.dom.querySelector("input, select") as
      | HTMLInputElement
      | HTMLSelectElement
      | null;
    if (!input) return "";
    if (input instanceof HTMLInputElement && input.type === "checkbox") {
      return input.checked;
    }
    return input.value;
  }
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

if (!customElements.get("fm-field")) {
  customElements.define("fm-field", FmField);
}
