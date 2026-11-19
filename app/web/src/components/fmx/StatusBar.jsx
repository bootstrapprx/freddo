import { blocks, money, toneFor } from "@/lib/finops";

export function StatusBar({ totalCost, budget, currency, nodeCount, benchCount, clock, daemon }) {
  const ratio = budget ? totalCost / budget : 0;
  const tone = toneFor(ratio);
  const online = Boolean(daemon?.online);
  const runtimeKind = daemon?.runtime?.kind || "docker";
  const runtimeOk = Boolean(daemon?.runtime?.ok ?? daemon?.docker);
  const runtimeLabel = runtimeKind === "none" || runtimeKind === "unknown" ? "runtime" : runtimeKind;
  const status = !online ? "offline" : runtimeOk ? "online" : `sem ${runtimeLabel}`;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-surface0/70 bg-mantle/50 px-4 py-2.5 text-[11px]">
      <div className="flex items-center gap-2">
        <span className="border border-mauve/60 bg-mauve/10 px-1.5 py-0.5 font-medium text-mauve">
          FMX
        </span>
        <span className="tracking-[0.18em] text-ink/90">CONTROL PLANE</span>
        <span className="text-overlay0">v{daemon?.version || "—"}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[9px] uppercase tracking-[0.2em] text-overlay0">burn mensal</span>
        <span className={`${tone} font-medium`}>{money(totalCost, currency)}</span>
        <span className="text-overlay0">/ {money(budget, currency)}</span>
        <span className={`${tone} tracking-[-0.12em]`}>{blocks(ratio, 16)}</span>
        <span className="text-sub0">{Math.round(ratio * 100)}%</span>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-4 text-[10px] text-overlay0">
        <span className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              online && runtimeOk ? "bg-green tui-live" : "bg-peach"
            }`}
          />
          <span className={online && runtimeOk ? "text-green" : "text-peach"}>
            daemon {status}
          </span>
        </span>
        <span className="hidden md:inline">
          {daemon?.provider || "unknown"} · {daemon?.mode || "offline"} · runtime {runtimeLabel}
          {daemon?.runtime?.shim ? " (shim)" : ""}
        </span>
        <span className="hidden sm:inline">{nodeCount} nodes</span>
        <span className="hidden sm:inline">{benchCount} benches</span>
        <span className="tabular-nums text-sub0">{clock || "--:--:--"}</span>
      </div>
    </div>
  );
}
