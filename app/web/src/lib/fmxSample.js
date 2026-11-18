// Local sample data used while the daemon bridge is unavailable (MockFmxProvider).
// Shapes mirror the SQLite models: nodes / benches / deployments / cost_allocations.

export const sampleNodes = [
  {
    id: "n1",
    name: "atlas-01",
    ip: "49.12.84.117",
    provider: "Hetzner",
    region: "Falkenstein · DE",
    vcpu: 8,
    ram_gb: 32,
    monthly_cost: 46,
    currency: "USD",
    status: "online",
    ssh_user: "root",
  },
  {
    id: "n2",
    name: "orion-02",
    ip: "173.212.241.64",
    provider: "Contabo",
    region: "Nuremberg · DE",
    vcpu: 6,
    ram_gb: 16,
    monthly_cost: 18.5,
    currency: "USD",
    status: "online",
    ssh_user: "frappe",
  },
  {
    id: "n3",
    name: "vega-03",
    ip: "164.90.187.22",
    provider: "DigitalOcean",
    region: "NYC3 · US",
    vcpu: 4,
    ram_gb: 8,
    monthly_cost: 24,
    currency: "USD",
    status: "degraded",
    ssh_user: "root",
  },
];

export const sampleBenches = [
  {
    id: "b1",
    node_id: "n1",
    name: "erp-prod-01",
    port: 8080,
    domain: "erp.acme.io",
    status: "running",
    env_tag: "production",
    cpu_pct: 42,
    ram_pct: 63,
    site_name: "erp.acme.io",
    frappe_version: "v15.42.1",
  },
  {
    id: "b2",
    node_id: "n1",
    name: "erp-stage-01",
    port: 8081,
    domain: "stage.acme.io",
    status: "running",
    env_tag: "staging",
    cpu_pct: 12,
    ram_pct: 28,
    site_name: "stage.acme.io",
    frappe_version: "v15.44.0-rc1",
  },
  {
    id: "b3",
    node_id: "n2",
    name: "hrms-prod-01",
    port: 8080,
    domain: "hr.acme.io",
    status: "running",
    env_tag: "production",
    cpu_pct: 55,
    ram_pct: 71,
    site_name: "hr.acme.io",
    frappe_version: "v15.42.1",
  },
  {
    id: "b4",
    node_id: "n2",
    name: "crm-demo",
    port: 8082,
    domain: "demo.acme.io",
    status: "stopped",
    env_tag: "dev",
    cpu_pct: 0,
    ram_pct: 4,
    site_name: "demo.acme.io",
    frappe_version: "v15.38.2",
  },
  {
    id: "b5",
    node_id: "n3",
    name: "warehouse-prod",
    port: 8080,
    domain: "wh.acme.io",
    status: "running",
    env_tag: "production",
    cpu_pct: 68,
    ram_pct: 74,
    site_name: "wh.acme.io",
    frappe_version: "v15.42.1",
  },
  {
    id: "b6",
    node_id: "n3",
    name: "sandbox-01",
    port: 8090,
    domain: "sandbox.acme.io",
    status: "provisioning",
    env_tag: "dev",
    cpu_pct: 8,
    ram_pct: 12,
    site_name: "sandbox.acme.io",
    frappe_version: "v15.44.0-rc1",
  },
];

export const sampleSettings = {
  monthly_budget: 100,
  currency: "USD",
  alert_threshold: 0.8,
  billing_cycle: "monthly",
  region: "america/manaus",
};

export const sampleDeployments = [
  {
    id: "d1",
    bench_id: "b1",
    kind: "migrate",
    status: "success",
    duration_s: 41.2,
    created_date: "2026-11-16T14:12:00.000Z",
    summary: "erpnext migrate · v15.42.1",
  },
  {
    id: "d2",
    bench_id: "b3",
    kind: "build",
    status: "success",
    duration_s: 96.8,
    created_date: "2026-11-15T09:03:00.000Z",
    summary: "bench build · hrms assets",
  },
  {
    id: "d3",
    bench_id: "b6",
    kind: "deploy",
    status: "failed",
    duration_s: 12.4,
    created_date: "2026-11-14T21:47:00.000Z",
    summary: "new bench · mariadb handshake timeout",
  },
];

function isoDay(offset) {
  const base = Date.UTC(2026, 10, 17);
  return new Date(base - offset * 86400000).toISOString().slice(0, 10);
}

// 14 days of daily cost allocation per bench (deterministic drift, no RNG).
export const sampleAllocations = (() => {
  const rows = [];
  const price = { b1: 24.15, b2: 9.2, b3: 11.66, b4: 0.37, b5: 17.04, b6: 2.4 };
  Object.entries(price).forEach(([benchId, base], benchIndex) => {
    for (let i = 13; i >= 0; i -= 1) {
      const drift = Math.sin((i + benchIndex * 2) / 2.6) * 0.11 + (13 - i) * 0.004;
      rows.push({
        bench_id: benchId,
        date: isoDay(i),
        allocated_cost: Number((base * (1 + drift)).toFixed(2)),
      });
    }
  });
  return rows;
})();

function fmtTime(totalSeconds) {
  const h = String(Math.floor(totalSeconds / 3600) % 24).padStart(2, "0");
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const s = String(totalSeconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function seedLogs(bench, node) {
  if (!bench) return [];
  const cpu = Number(bench.cpu_pct) || 0;
  const ram = Number(bench.ram_pct) || 0;
  const ramGb = node ? Math.round((ram / 100) * node.ram_gb) : 0;
  const lines = [
    { level: "CMD", msg: `fmx info --bench ${bench.name}` },
    { level: "OK", msg: `bench ${bench.name}: site status ${bench.status === "stopped" ? "stopped" : "ok"} (${bench.frappe_version})` },
    { level: "INFO", msg: `cgroup v2 sample → cpu ${cpu.toFixed(1)}% · mem ${ramGb}G/${node ? node.ram_gb : "?"}G` },
    { level: "INFO", msg: `${bench.name} @ ${node ? node.ip : "-"}:${bench.port} · ${bench.domain} · tls válido 68d` },
    { level: "WARN", msg: "mariadb slow query 812ms · tabSales Invoice" },
    { level: "INFO", msg: "redis queue short: 3 jobs · long: 0 jobs" },
    { level: "OK", msg: "scheduler enabled · último run 18:15:00 (7 jobs)" },
  ];
  const start = 18 * 3600 + 19 * 60 + 2;
  return lines.map((line, i) => ({ ...line, t: fmtTime(start + i * 37) }));
}

export function configFor(bench, node) {
  if (!bench) return [];
  return [
    ["bench name", bench.name],
    ["bench path", "/home/frappe/frappe-bench"],
    ["node", node ? `${node.name} · ${node.ip}` : "-"],
    ["http port", String(bench.port)],
    ["domain", bench.domain],
    ["site", bench.site_name],
    ["frappe image", `frappe/erpnext:${bench.frappe_version}`],
    ["mariadb", "mariadb:10.6"],
    ["redis", "redis:6.2-alpine"],
    ["compose project", `fmx-${bench.name}`],
    ["backup policy", "diário 03:00 UTC · retenção 7"],
    ["environment tag", bench.env_tag],
  ];
}