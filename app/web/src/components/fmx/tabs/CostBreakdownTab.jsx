import { blocks, money, pct, toneFor } from "@/lib/finops";

export function CostBreakdownTab({ rows = [], total = 0, budget = 0, currency = "USD" }) {
  const ratio = budget ? total / budget : 0;
  return (
    <div className="px-4 py-3">
      <div className="hidden grid-cols-[1.5fr_1fr_0.6fr_0.6fr] gap-3 pb-1 text-[9px] uppercase tracking-[0.2em] text-overlay0 sm:grid">
        <span>bench</span>
        <span>alocação cgroup</span>
        <span className="text-right">share</span>
        <span className="text-right">custo/mo</span>
      </div>

      {rows.map((row) => (
        <div
          key={row.id}
          className="grid grid-cols-[1.3fr_0.9fr_0.5fr_0.55fr] items-center gap-3 border-b border-surface0/40 py-1.5 text-[10.5px] sm:grid-cols-[1.5fr_1fr_0.6fr_0.6fr]"
        >
          <span className="truncate text-sub1">{row.name}</span>
          <span className={`truncate tracking-[-0.1em] ${toneFor(row.util)}`}>
            {blocks(row.util, 12)}
          </span>
          <span className="text-right tabular-nums text-overlay1">
            {pct(total ? (row.cost / total) * 100 : 0, 0)}
          </span>
          <span className="text-right tabular-nums text-teal">{money(row.cost, currency)}</span>
        </div>
      ))}

      <div className="mt-3 border border-surface0/60 bg-mantle/40 px-3 py-2">
        <div className="flex items-baseline justify-between text-[10.5px]">
          <span className="text-[9px] uppercase tracking-[0.2em] text-overlay0">
            total alocado
          </span>
          <span className={`text-[13px] tabular-nums ${toneFor(ratio)}`}>
            {money(total, currency)}
          </span>
        </div>
        <div className={`mt-1 tracking-[-0.12em] ${toneFor(ratio)}`}>{blocks(ratio, 28)}</div>
        <div className="mt-1 flex justify-between text-[9px] text-overlay0">
          <span>orçamento {money(budget, currency)}</span>
          <span>{pct(ratio * 100, 0)} consumido</span>
        </div>
        <p className="mt-2 text-[9px] leading-relaxed text-overlay0">
          custo = ((cpu% × 0.5) + (ram% × 0.5)) / 100 × custo fixo da VPS · amostragem cgroup v2 a
          cada 1.4s
        </p>
      </div>
    </div>
  );
}