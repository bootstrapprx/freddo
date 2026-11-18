import { BrailleChart } from "./BrailleChart";
import { LogsTab } from "./tabs/LogsTab";
import { CostBreakdownTab } from "./tabs/CostBreakdownTab";
import { ConfigTab } from "./tabs/ConfigTab";
import { ForecastTab } from "./tabs/ForecastTab";
import { money, pct, toneFor } from "@/lib/finops";

const TABS = [
  { id: "logs", label: "Logs" },
  { id: "cost", label: "Cost Breakdown" },
  { id: "config", label: "FMX Config" },
  { id: "forecast", label: "Forecast" },
];

const ENV_TONE = {
  production: "border-red/40 bg-red/10 text-red",
  staging: "border-peach/40 bg-peach/10 text-peach",
  dev: "border-blue/40 bg-blue/10 text-blue",
};

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

function ChartBox({ label, value, values, tone, meta }) {
  return (
    <div className="border border-surface0/60 bg-mantle/40 px-3 py-2">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[9px] uppercase tracking-[0.22em] text-overlay0">{label}</span>
        <span className={`text-[13px] tabular-nums ${tone}`}>{value}</span>
      </div>
      {values.length ? (
        <BrailleChart values={values} width={40} height={4} tone={tone} />
      ) : (
        <div className="py-2 text-[9px] text-overlay0">sem amostras docker</div>
      )}
      <div className="mt-1 truncate text-[9px] text-overlay0">{meta}</div>
    </div>
  );
}

export function TelemetryPanel({
  bench,
  node,
  series,
  live,
  source = "seed",
  tab,
  onTab,
  logs,
  running,
  costRows,
  totalCost,
  budget,
  currency,
  configRows,
  history,
  forecastData,
  deployments = [],
}) {
  if (!bench) {
    return (
      <div className="flex min-h-[420px] items-center justify-center px-6 text-[11px] text-overlay0">
        nenhum bench selecionado · pressione [a] para adicionar um node
      </div>
    );
  }

  return (
    <div className="flex min-h-[420px] flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-surface0/70 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[9px] ${STATUS_TONE[bench.status] || "text-overlay0"}`}>
              {STATUS_GLYPH[bench.status] || "○"}
            </span>
            <span className="text-[14px] text-ink">{bench.name}</span>
            <span
              className={`border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em] ${
                ENV_TONE[bench.env_tag] || "border-surface1 text-sub0"
              }`}
            >
              {bench.env_tag}
            </span>
            {running && (
              <span className="border border-yellow/40 bg-yellow/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em] text-yellow">
                migrate em curso
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-overlay0">
            <span className="text-blue">{bench.domain}</span>
            <span>:{bench.port}</span>
            <span>node {node ? node.name : "-"}</span>
            <span>
              {node ? `${node.provider} · ${node.region}` : ""}
            </span>
            <span>{bench.frappe_version}</span>
          </div>
        </div>

        <div className="flex gap-4 text-right text-[10px]">
          <div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-overlay0">custo</div>
            <div className="text-[12px] tabular-nums text-teal">
              {money(
                costRows.find((row) => row.id === bench.id)?.cost || 0,
                currency,
              )}
              <span className="text-overlay0">/mo</span>
            </div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-[0.18em] text-overlay0">shared</div>
            <div className={`text-[12px] tabular-nums ${toneFor(live.cpu / 100)}`}>
              {pct((costRows.find((row) => row.id === bench.id)?.util || 0) * 100, 0)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 border-b border-surface0/70 px-4 py-3 sm:grid-cols-2">
        <ChartBox
          label="cpu"
          value={pct(live.cpu)}
          values={series.cpu}
          tone="text-mauve"
          meta={`${node ? node.vcpu : "-"} vCPU · ${
            source === "docker" ? "docker stats" : source === "unavailable" ? "sem amostra" : "seed (demo)"
          }`}
        />
        <ChartBox
          label="ram"
          value={pct(live.ram)}
          values={series.ram}
          tone="text-blue"
          meta={`${node ? Math.round((live.ram / 100) * node.ram_gb) : 0}G / ${
            node ? node.ram_gb : "-"
          }G`}
        />
      </div>

      <div className="flex flex-wrap gap-1 px-3 pt-2">
        {TABS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onTab(item.id)}
            className={`border-b px-2 pb-1.5 pt-1 text-[10px] transition-colors ${
              tab === item.id
                ? "border-mauve text-mauve"
                : "border-transparent text-overlay1 hover:text-sub0"
            }`}
          >
            <span className="mr-1 text-overlay0">{index + 1}</span>
            [ {item.label} ]
          </button>
        ))}
      </div>

      <div className="flex-1">
        {tab === "logs" && (
          <LogsTab lines={logs} running={running} deployments={deployments} />
        )}
        {tab === "cost" && (
          <CostBreakdownTab
            rows={costRows}
            total={totalCost}
            budget={budget}
            currency={currency}
          />
        )}
        {tab === "config" && <ConfigTab rows={configRows} />}
        {tab === "forecast" && (
          <ForecastTab
            history={history}
            forecastData={forecastData}
            budget={budget}
            currency={currency}
            total={totalCost}
          />
        )}
      </div>
    </div>
  );
}