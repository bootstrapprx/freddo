import { BrailleChart } from "../BrailleChart";
import { money, pct, toneFor } from "@/lib/finops";

function Stat({ label, value, tone = "text-ink", hint }) {
  return (
    <div className="border border-surface0/60 bg-mantle/40 px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.2em] text-overlay0">{label}</div>
      <div className={`mt-0.5 text-[13px] tabular-nums ${tone}`}>{value}</div>
      {hint && <div className="text-[9px] text-overlay0">{hint}</div>}
    </div>
  );
}

export function ForecastTab({ history = [], forecastData, budget = 0, currency = "USD", total = 0 }) {
  const runRate = forecastData?.runRate || 0;
  const ratio = budget ? runRate / budget : 0;
  const tone = toneFor(ratio);
  const series = history.map((point) => (budget ? point.cost / budget : 0));
  const slopeTone = (forecastData?.slope || 0) >= 0 ? "text-peach" : "text-green";

  let verdict = "run rate dentro do orçamento — margem confortável";
  if (ratio >= 1) verdict = "ALERTA: run rate projeta estouro do orçamento mensal";
  else if (ratio >= 0.8) verdict = "atenção: run rate acima de 80% do orçamento";

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="run rate 30d" value={money(runRate, currency)} tone={tone} hint={`${pct(ratio * 100, 0)} do budget`} />
        <Stat label="projeção 7d" value={money(forecastData?.d7 || 0, currency)} hint="por dia" />
        <Stat label="projeção 30d" value={money(forecastData?.d30 || 0, currency)} hint="por dia" />
        <Stat
          label="tendência"
          value={`${(forecastData?.slope || 0) >= 0 ? "▲" : "▼"} ${money(Math.abs(forecastData?.slope || 0), currency)}`}
          tone={slopeTone}
          hint="por dia"
        />
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between text-[9px] uppercase tracking-[0.2em] text-overlay0">
          <span>histórico 14d · custo alocado</span>
          <span>
            hoje {money(total, currency)} · orçamento {money(budget, currency)}
          </span>
        </div>
        <BrailleChart values={series} width={54} height={5} tone="text-teal" />
      </div>

      <div
        className={`border px-3 py-2 text-[10.5px] ${
          ratio >= 1
            ? "border-red/50 bg-red/10 text-red"
            : ratio >= 0.8
              ? "border-peach/50 bg-peach/10 text-peach"
              : "border-green/40 bg-green/10 text-green"
        }`}
      >
        {verdict}
      </div>
    </div>
  );
}