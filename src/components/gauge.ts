// <fm-gauge> custom element: accessible meter with label, value, min/max.
//
// Attributes: label, value, min (default 0), max (default 100), unit, precision.
// Renders role="meter" with aria-valuenow/min/max/text. Updates on attribute change.

const PRECISION_DEFAULT = 0;

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

function formatValue(v: number, precision: number): string {
  return v.toFixed(precision);
}

export class FmGauge extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["label", "value", "min", "max", "unit", "precision"];
  }

  private connected = false;

  constructor() {
    super();
  }

  connectedCallback(): void {
    this.connected = true;
    this.renderMarkup();
    this.syncAria();
  }

  disconnectedCallback(): void {
    this.connected = false;
  }

  private renderMarkup(): void {
    const label = this.getAttribute("label") ?? "";
    const min = this.numAttr("min", 0);
    const max = this.numAttr("max", 100);
    const precision = this.numAttr("precision", PRECISION_DEFAULT);
    const raw = this.numAttr("value", min);
    const value = clamp(raw, min, max);
    const unit = this.getAttribute("unit") ?? "";
    const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
    const text = `${formatValue(value, precision)}${unit ? " " + unit : ""}`;

    const html = `
      <style>
        :host { display: block; font-family: inherit; }
        .wrap { display: flex; flex-direction: column; gap: 0.25rem; }
        .label { font-size: 0.75rem; color: var(--fm-muted, #9aa0a6); text-transform: uppercase; letter-spacing: 0.04em; }
        .bar { position: relative; height: 10px; background: var(--fm-track, #2a2a2a); border-radius: 6px; overflow: hidden; }
        .fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--fm-accent, #4a9eff); width: ${pct}%; transition: width 0.2s ease; }
        .val { font-size: 1.1rem; font-weight: 600; color: var(--fm-text, #e0e0e0); }
      </style>
      <div class="wrap">
        <span class="label">${escapeText(label)}</span>
        <div class="bar"><div class="fill"></div></div>
        <span class="val">${text}</span>
      </div>
    `;

    if (this.shadowRoot) {
      this.shadowRoot.innerHTML = html;
    } else {
      this.innerHTML = html;
    }
  }

  private syncAria(): void {
    const min = this.numAttr("min", 0);
    const max = this.numAttr("max", 100);
    const value = clamp(this.numAttr("value", min), min, max);
    const precision = this.numAttr("precision", PRECISION_DEFAULT);
    const unit = this.getAttribute("unit") ?? "";
    const text = `${formatValue(value, precision)}${unit ? " " + unit : ""}`;
    this.setAttribute("role", "meter");
    this.setAttribute("aria-valuemin", String(min));
    this.setAttribute("aria-valuemax", String(max));
    this.setAttribute("aria-valuenow", String(value));
    this.setAttribute("aria-valuetext", text);
  }

  private numAttr(name: string, fallback: number): number {
    const raw = this.getAttribute(name);
    if (raw === null || raw === "") return fallback;
    const n = Number(raw);
    return Number.isNaN(n) ? fallback : n;
  }

  attributeChangedCallback(): void {
    if (!this.connected) return;
    this.renderMarkup();
    this.syncAria();
  }

  get value(): number {
    return this.numAttr("value", this.numAttr("min", 0));
  }

  set value(v: number) {
    this.setAttribute("value", String(v));
  }
}

if (!customElements.get("fm-gauge")) {
  customElements.define("fm-gauge", FmGauge);
}
