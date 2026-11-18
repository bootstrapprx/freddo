// FinOps engine: proportional cost allocation + linear trend projection.
//
//   cost(bench) = ((cpu% * wc) + (ram% * wr)) / 100 * node.monthly_cost
//
// where cpu%/ram% are the bench's share of the node's total capacity,
// measured from cgroup v2 counters.

export const UTIL_WEIGHT = { cpu: 0.5, ram: 0.5 };

export function utilization(cpuPct = 0, ramPct = 0) {
  const cpu = Math.min(100, Math.max(0, Number(cpuPct) || 0));
  const ram = Math.min(100, Math.max(0, Number(ramPct) || 0));
  return Math.min(1, (cpu * UTIL_WEIGHT.cpu + ram * UTIL_WEIGHT.ram) / 100);
}

export function allocatedCost(cpuPct, ramPct, node) {
  if (!node) return 0;
  return utilization(cpuPct, ramPct) * (Number(node.monthly_cost) || 0);
}

export function symbolFor(currency = "USD") {
  if (currency === "EUR") return "€";
  if (currency === "BRL") return "R$";
  return "$";
}

export function money(value, currency = "USD") {
  const v = Number.isFinite(Number(value)) ? Number(value) : 0;
  const sign = v < 0 ? "-" : "";
  return `${sign}${symbolFor(currency)}${Math.abs(v).toFixed(2)}`;
}

export function pct(value, digits = 1) {
  const v = Number.isFinite(Number(value)) ? Number(value) : 0;
  return `${v.toFixed(digits)}%`;
}

export function blocks(ratio, width = 18) {
  const clamped = Math.min(1, Math.max(0, Number(ratio) || 0));
  const filled = Math.round(clamped * width);
  return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`;
}

export function toneFor(ratio) {
  if (ratio >= 0.85) return "text-red";
  if (ratio >= 0.7) return "text-peach";
  return "text-green";
}

export function forecast(history) {
  const points = (history || []).map((h) => Number(h.cost) || 0);
  const n = points.length;
  if (n === 0) return { last: 0, slope: 0, d7: 0, d30: 0, runRate: 0 };
  const last = points[n - 1];
  if (n < 3) {
    return { last, slope: 0, d7: last, d30: last, runRate: Math.max(0, last) * 30 };
  }
  const mx = (n - 1) / 2;
  const my = points.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  points.forEach((value, i) => {
    num += (i - mx) * (value - my);
    den += (i - mx) ** 2;
  });
  const slope = den ? num / den : 0;
  const project = (days) => Math.max(0, last + slope * days);
  return { last, slope, d7: project(7), d30: project(30), runRate: Math.max(0, last) * 30 };
}