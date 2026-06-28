// Server config form: server_host, server_port, server_protocol (select),
// server_path, server_sync_interval, ping_back_interval.
// Validation: host non-empty, port 0-65535.

import type { DeviceConfig, ServerProtocol } from "../lib/tauri";
import { createFormView, type FormView, type Validator } from "./form-shared";

const PROTOCOL_OPTIONS: Array<[string, string]> = [
  ["udp", "UDP"],
  ["https_get", "HTTPS GET"],
  ["https_post", "HTTPS POST"],
];

const validators: Partial<Record<keyof DeviceConfig, Validator>> = {
  server_host: (v) => {
    const s = String(v).trim();
    if (s.length === 0) return "Host required";
    return null;
  },
  server_port: (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 65535) return "Port 0-65535";
    return null;
  },
  server_sync_interval: (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) return "Must be non-negative integer";
    return null;
  },
  ping_back_interval: (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) return "Must be non-negative integer";
    return null;
  },
};

export function createServerView(
  portPath: string,
  config: DeviceConfig,
  onApplied?: (cfg: DeviceConfig) => void
): FormView {
  return createFormView({
    portPath,
    config,
    title: "Server",
    validators,
    onApplied,
    fields: [
      { name: "server_host", label: "Server Host", type: "text", placeholder: "telemetry.example.com" },
      { name: "server_port", label: "Server Port", type: "number", min: 0, max: 65535, step: 1 },
      {
        name: "server_protocol",
        label: "Protocol",
        type: "select",
        options: PROTOCOL_OPTIONS,
      },
      { name: "server_path", label: "Server Path", type: "text", placeholder: "/api/telemetry" },
      { name: "server_sync_interval", label: "Sync Interval (s)", type: "number", min: 0, step: 1 },
      { name: "ping_back_interval", label: "Ping-back Interval (s)", type: "number", min: 0, step: 1 },
    ],
  });
}

export function protocolLabel(p: ServerProtocol): string {
  return PROTOCOL_OPTIONS.find(([v]) => v === p)?.[1] ?? p;
}
