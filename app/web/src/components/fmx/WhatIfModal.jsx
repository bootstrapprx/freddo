import { useState } from "react";
import { ModalFrame, ghostButton, inputClass, labelClass, primaryButton } from "./ModalFrame";
import { money, pct, toneFor, utilization } from "@/lib/finops";

export function WhatIfModal({ nodes, currency, currentTotal, budget, onClose, onSubmit }) {
  const [form, setForm] = useState({
    node_id: nodes[0]?.id || "",
    name: "",
    env_tag: "dev",
    cpu_pct: "35",
    ram_pct: "45",
  });

  const node = nodes.find((item) => item.id === form.node_id) || nodes[0];
  const util = utilization(Number(form.cpu_pct) || 0, Number(form.ram_pct) || 0);
  const added = node ? util * (Number(node.monthly_cost) || 0) : 0;
  const nextTotal = currentTotal + added;
  const ratio = budget ? nextTotal / budget : 0;
  const valid = Boolean(form.name.trim() && node);

  const verdict =
    ratio >= 1
      ? "estouro de orçamento: reduza a expectativa de consumo ou mova o bench para outro node"
      : ratio >= 0.85
        ? "zona de alerta: o novo total passa de 85% do orçamento"
        : "dentro do orçamento: alocação segura para o próximo ciclo";

  return (
    <ModalFrame
      title="what-if"
      hint="simular impacto financeiro antes do deploy"
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <span className="text-[9px] uppercase tracking-[0.16em] text-overlay0">
            simulação local · confirmação chama o FMX
          </span>
          <div className="flex gap-2">
            <button type="button" className={ghostButton} onClick={onClose}>
              apenas simular
            </button>
            <button
              type="submit"
              form="what-if-form"
              className={primaryButton}
              disabled={!valid}
            >
              criar bench no fmx
            </button>
          </div>
        </>
      }
    >
      <form
        id="what-if-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          onSubmit(form);
        }}
        className="space-y-3"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="wi-node">
              node alvo
            </label>
            <select
              id="wi-node"
              className={inputClass}
              value={form.node_id}
              onChange={(event) => setForm((prev) => ({ ...prev, node_id: event.target.value }))}
            >
              {nodes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {money(item.monthly_cost, currency)}/mo
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="wi-name">
              nome do bench
            </label>
            <input
              id="wi-name"
              className={inputClass}
              value={form.name}
              placeholder="erp-prod-02"
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="wi-cpu">
              cpu esperado (% do node)
            </label>
            <input
              id="wi-cpu"
              className={inputClass}
              value={form.cpu_pct}
              inputMode="decimal"
              onChange={(event) => setForm((prev) => ({ ...prev, cpu_pct: event.target.value }))}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="wi-ram">
              ram esperada (% do node)
            </label>
            <input
              id="wi-ram"
              className={inputClass}
              value={form.ram_pct}
              inputMode="decimal"
              onChange={(event) => setForm((prev) => ({ ...prev, ram_pct: event.target.value }))}
            />
          </div>
        </div>

        <div className="border border-surface0/60 bg-mantle/40 px-3 py-2 text-[10.5px]">
          <div className="mb-1 flex justify-between">
            <span className="text-overlay0">utilização combinada</span>
            <span className="text-mauve">{pct(util * 100, 0)}</span>
          </div>
          <div className="mb-1 flex justify-between">
            <span className="text-overlay0">custo fixo do node</span>
            <span className="text-sub1">{money(node?.monthly_cost || 0, currency)}</span>
          </div>
          <div className="mb-1 flex justify-between">
            <span className="text-overlay0">custo incremental do bench</span>
            <span className="text-teal">+{money(added, currency)}</span>
          </div>
          <div className="mb-1 flex justify-between border-t border-surface0/50 pt-1">
            <span className="text-overlay0">novo total mensal</span>
            <span className={`tabular-nums ${toneFor(ratio)}`}>{money(nextTotal, currency)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-overlay0">orçamento consumido</span>
            <span className={`tabular-nums ${toneFor(ratio)}`}>{pct(ratio * 100, 0)}</span>
          </div>
        </div>

        <p className="text-[9px] leading-relaxed text-overlay0">
          ao confirmar, o daemon executa fmx -n create &lt;bench&gt; --apps ... --environment
          dev|prod. A alocação de custo acima é apenas uma projeção; a telemetria real virá do stats
          do runtime ativo (docker ou podman) quando o bench existir.
        </p>

        <p
          className={`border px-3 py-2 text-[10px] leading-relaxed ${
            ratio >= 1
              ? "border-red/50 bg-red/10 text-red"
              : ratio >= 0.85
                ? "border-peach/50 bg-peach/10 text-peach"
                : "border-green/40 bg-green/10 text-green"
          }`}
        >
          {verdict}
        </p>
      </form>
    </ModalFrame>
  );
}