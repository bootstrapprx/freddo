import { env } from "cloudflare:workers";

// Server-only bridge to the local fmx-control daemon. Never import from client code.
const DEFAULT_URL = "http://127.0.0.1:7420";
const DEFAULT_TIMEOUT = 8_000;
const HEALTH_TIMEOUT = 2_000;
const TELEMETRY_TIMEOUT = 15_000;

function settings() {
  const configured = env.FMX_DAEMON_URL || DEFAULT_URL;
  let url;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("FMX_DAEMON_URL inválida");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("FMX_DAEMON_URL deve usar http ou https");
  }
  const interval = Number(env.FMX_TELEMETRY_INTERVAL_S || 15);
  return {
    baseUrl: url.toString().replace(/\/$/, ""),
    token: env.FMX_DAEMON_TOKEN || null,
    telemetryIntervalMs: (Number.isFinite(interval) && interval > 0 ? interval : 15) * 1000,
    providerLabel: env.FMX_PROVIDER_LABEL || null,
  };
}

export function daemonSettings() {
  const config = settings();
  return {
    url: config.baseUrl,
    authenticated: Boolean(config.token),
    telemetryIntervalMs: config.telemetryIntervalMs,
  };
}

async function request(path, { method = "GET", body, timeoutMs = DEFAULT_TIMEOUT } = {}) {
  const config = settings();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (config.token) headers.Authorization = `Bearer ${config.token}`;

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: payload?.error?.message || `daemon respondeu ${response.status}`,
        code: payload?.error?.code || null,
      };
    }
    return {
      ok: true,
      status: response.status,
      data: payload?.data ?? payload,
      envelope: payload,
    };
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return {
      ok: false,
      status: 0,
      error: timedOut ? "timeout ao contatar o daemon" : "daemon fmx-control indisponível",
      code: timedOut ? "DAEMON_TIMEOUT" : "DAEMON_OFFLINE",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function getDaemonHealth() {
  return request("/healthz", { timeoutMs: HEALTH_TIMEOUT });
}

export function startDaemonOperation(path, body) {
  return request(path, { method: "POST", body, timeoutMs: DEFAULT_TIMEOUT });
}

export function getDaemonOperation(operationId) {
  return request(`/v1/operations/${encodeURIComponent(operationId)}`, {
    timeoutMs: HEALTH_TIMEOUT,
  });
}

export function collectDaemonTelemetry(benches) {
  return request("/v1/telemetry/collect", {
    method: "POST",
    body: { benches },
    timeoutMs: TELEMETRY_TIMEOUT,
  });
}
