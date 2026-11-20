const BASE = "/api/v1";
let csrfToken = null;

export async function fetchCsrf(force = false) {
  if (csrfToken && !force) return csrfToken;
  const response = await fetch(`${BASE}/auth/csrf`, { credentials: "same-origin" });
  if (!response.ok) throw new Error("csrf_unavailable");
  const data = await response.json();
  csrfToken = data.csrf_token;
  return csrfToken;
}

export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.message || payload?.detail || `HTTP ${status}`);
    this.status = status;
    this.code = payload?.code || payload?.detail || "request_error";
    this.details = payload?.details;
  }
}

export async function api(path, options = {}) {
  const { method = "GET", body, raw = false, ...rest } = options;
  const headers = { Accept: "application/json", ...(rest.headers || {}) };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD"].includes(method)) {
    const token = await fetchCsrf();
    headers["x-csrf-token"] = token;
  }
  const response = await fetch(`${BASE}${path}`, {
    ...rest,
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401 && !path.startsWith("/auth/")) {
    window.dispatchEvent(new CustomEvent("freddo:unauthorized"));
  }
  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    throw new ApiError(response.status, payload);
  }
  if (raw) return response;
  if (response.status === 204) return null;
  return response.json();
}

export function stream(path, { onEvent, onError, lastEventId } = {}) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (lastEventId) url.searchParams.set("Last-Event-ID", String(lastEventId));
  const source = new EventSource(url, { withCredentials: true });
  const handler = (event) => {
    try {
      onEvent?.({ type: event.type, ...JSON.parse(event.data) });
    } catch {
      onEvent?.({ type: event.type, line: event.data });
    }
  };
  for (const type of ["line", "status", "error", "done", "job_done", "message"]) {
    source.addEventListener(type, handler);
  }
  source.onerror = (error) => onError?.(error);
  return () => source.close();
}

export const endpoints = {
  benches: () => api("/benches"),
  bench: (name) => api(`/benches/${encodeURIComponent(name)}`),
  createBench: (data) => api("/benches", { method: "POST", body: data }),
  deleteBench: (name) => api(`/benches/${encodeURIComponent(name)}`, { method: "DELETE", body: { confirm: name } }),
  benchAction: (name, action, data = {}) =>
    api(`/benches/${encodeURIComponent(name)}/actions/${action}`, { method: "POST", body: { action, ...data } }),
  updateBench: (name, config) => api(`/benches/${encodeURIComponent(name)}/config`, { method: "PATCH", body: { config } }),
  sslStatus: (name) => api(`/benches/${encodeURIComponent(name)}/ssl`),
  sslAction: (name, operation, domain) =>
    api(`/benches/${encodeURIComponent(name)}/ssl`, { method: "POST", body: { operation, domain } }),
  ngrok: (name, data) => api(`/benches/${encodeURIComponent(name)}/ngrok`, { method: "POST", body: data }),
  jobs: (params = {}) => api(`/jobs?${new URLSearchParams(params)}`),
  job: (id) => api(`/jobs/${id}`),
  cancelJob: (id) => api(`/jobs/${id}/cancel`, { method: "POST" }),
  overview: () => api("/telemetry/overview"),
  telemetry: (params) => api(`/telemetry/query?${new URLSearchParams(params)}`),
  metrics: () => api("/telemetry/metrics"),
  rules: () => api("/alerts/rules"),
  saveRule: (rule, id) => api(id ? `/alerts/rules/${id}` : "/alerts/rules", { method: id ? "PUT" : "POST", body: rule }),
  deleteRule: (id) => api(`/alerts/rules/${id}`, { method: "DELETE" }),
  alertEvents: () => api("/alerts/events"),
  templates: () => api("/templates"),
  saveTemplate: (template) => api("/templates", { method: "POST", body: template }),
  deleteTemplate: (name) => api(`/templates/${encodeURIComponent(name)}`, { method: "DELETE" }),
  audit: () => api("/audit"),
  verifyAudit: () => api("/audit/verify"),
  services: () => api("/services"),
  serviceAction: (service, action) => api(`/services/${service}/actions/${action}`, { method: "POST", body: { service, action } }),
  fmVersion: () => api("/system/fm"),
  fmAction: (kind, backupConfirmed) =>
    api(`/system/fm/${kind}`, { method: "POST", body: { backup_confirmed: backupConfirmed, confirm: "system" } }),
  system: () => api("/system"),
  deploymentConfig: () => api("/deployment/config"),
  saveDeploymentDomains: (domains) => api("/deployment/domains", { method: "PUT", body: { domains } }),
  setTunnelToken: (token) => api("/deployment/tunnel-token", { method: "PUT", body: { token } }),
  deleteTunnelToken: () => api("/deployment/tunnel-token", { method: "DELETE" }),
  connectTunnel: () => api("/deployment/tunnel/connect", { method: "POST", body: {} }),
  disconnectTunnel: () => api("/deployment/tunnel/disconnect", { method: "POST", body: {} }),
  createSite: (data) => api("/deployment/sites", { method: "POST", body: data }),
  authSetup: () => api("/auth/setup"),
  login: (data) => api("/auth/login", { method: "POST", body: data }),
  logout: () => api("/auth/logout", { method: "POST" }),
  me: () => api("/auth/me"),
  stepup: (data) => api("/auth/stepup", { method: "POST", body: data }),
};
