import { money, pct, toneFor } from "@/lib/finops";

const STATUS_GLYPH = {
  running: "●",
  stopped: "○",
  provisioning: "◐",
  degraded: "◍",
  failed: "✕",
};

const STATUS_TONE = {
  running: "text-green",
  stopped: "text-overlay0",
  provisioning: "text-yellow",
  degraded: "text-peach",
  failed: "text-red",
};

function MiniBar({ ratio }) {
  const width = 6;
  const filled = Math.round(Math.min(1, Math.max(0, ratio)) * width);
  return (
    <span className="text-[9px] tracking-[-0.1em] text-overlay0">
      {"▰".repeat(filled)}
      {"▱".repeat(Math.max(0, width - filled))}
    </span>
  );
}

export function ResourceTree({
  tree,
  expanded,
  onToggle,
  selectedId,
  onSelect,
  live,
  costs,
  currency,
  nodeCount,
}) {
  return (
    <div className="flex min-h-[420px] flex-col border-surface0/70 lg:border-r">
      <div className="flex items-center justify-between border-b border-surface0/50 px-3 py-2">
        <span className="text-[9px] uppercase tracking-[0.24em] text-overlay0">
          nodes / vps pool
        </span>
        <span className="text-[9px] text-overlay0">{nodeCount}</span>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {tree.map(({ node, benches }) => {
          const isOpen = expanded.has(node.id);
          return (
            <div key={node.id}>
              <button
                type="button"
                onClick={() => onToggle(node.id)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-surface0/50"
              >
                <span className="w-3 text-[10px] text-overlay1">{isOpen ? "▾" : "▸"}</span>
                <span className={`text-[9px] ${STATUS_TONE[node.status] || "text-overlay1"}`}>
                  {STATUS_GLYPH[node.status] || "●"}
                </span>
                <span className="flex-1 truncate text-[12px] text-ink">{node.name}</span>
                <span className="shrink-0 text-[9px] text-overlay0">
                  {node.vcpu}c·{node.ram_gb}g
                </span>
              </button>

              {isOpen && (
                <div className="pb-0.5">
                  {benches.map((bench) => {
                    const isSelected = bench.id === selectedId;
                    const l = live[bench.id] || { cpu: 0, ram: 0 };
                    return (
                      <button
                        key={bench.id}
                        type="button"
                        onClick={() => onSelect(bench.id)}
                        className={`flex w-full items-center gap-2 border-l-2 py-1 pl-7 pr-3 text-left transition-colors ${
                          isSelected
                            ? "border-mauve bg-mauve/10"
                            : "border-transparent hover:bg-surface0/40"
                        }`}
                      >
                        <span
                          className={`text-[9px] ${
                            STATUS_TONE[bench.status] || "text-overlay1"
                          }`}
                        >
                          {STATUS_GLYPH[bench.status] || "○"}
                        </span>
                        <span
                          className={`flex-1 truncate text-[11px] ${
                            isSelected ? "text-ink" : "text-sub1"
                          }`}
                        >
                          {bench.name}
                        </span>
                        <MiniBar ratio={l.cpu / 100} />
                        <span className="w-9 shrink-0 text-right text-[9px] tabular-nums text-overlay1">
                          {pct(l.cpu, 0)}
                        </span>
                        <span
                          className={`w-11 shrink-0 text-right text-[9px] tabular-nums ${toneFor(
                            l.ram / 100,
                          )}`}
                        >
                          {money(costs[bench.id] || 0, currency)}
                        </span>
                      </button>
                    );
                  })}
                  {benches.length === 0 && (
                    <p className="pl-7 pr-3 py-1 text-[10px] text-overlay0">nenhum bench</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-surface0/50 px-3 py-2 text-[9px] uppercase tracking-[0.16em] text-overlay0">
        <div className="flex justify-between">
          <span>j/k navegar</span>
          <span>▸ expandir</span>
        </div>
      </div>
    </div>
  );
}