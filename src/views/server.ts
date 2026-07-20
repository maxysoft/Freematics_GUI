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
  // Both stored as int16_t on the device — bound them so a large value can't
  // wrap negative (the firmware also rejects out-of-range with ERR now).
  server_sync_interval: (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 32767) return "0-32767 seconds";
    return null;
  },
  ping_back_interval: (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 32767) return "0-32767 seconds";
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
      { name: "server_host", label: "Server Host", type: "text", placeholder: "telemetry.example.com", desc: "Hostname or IP of the telemetry server the device uploads to (e.g. hub.freematics.com or your own server). Applied on the next device restart." },
      { name: "server_port", label: "Server Port", type: "number", min: 0, max: 65535, step: 1, desc: "Network port on the telemetry server. Freematics Hub uses 8081 (UDP); HTTPS typically 443. Leave 0 for the protocol default. Applied on restart." },
      {
        name: "server_protocol",
        label: "Protocol",
        type: "select",
        options: PROTOCOL_OPTIONS,
        desc: "How data is sent: UDP (lowest overhead, default) or HTTPS GET/POST (encrypted, higher overhead). Applied on the next device restart.",
      },
      { name: "server_path", label: "Server Path", type: "text", placeholder: "/api/telemetry", desc: "URL path for the HTTPS modes (e.g. /push). Ignored for UDP. Applied on restart." },
      { name: "server_sync_interval", label: "Sync Interval (s)", type: "number", min: 0, step: 1, desc: "Seconds between data uploads to the server. Lower means more frequent updates and more data usage." },
      { name: "ping_back_interval", label: "Ping-back Interval (s)", type: "number", min: 0, step: 1, desc: "Seconds between keep-alive pings while idle, to hold the connection open. 0 disables ping-backs." },
    ],
  });
}

export function protocolLabel(p: ServerProtocol): string {
  return PROTOCOL_OPTIONS.find(([v]) => v === p)?.[1] ?? p;
}
