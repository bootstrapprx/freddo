import { useState } from "react";
import {
  ModalFrame,
  ghostButton,
  inputClass,
  labelClass,
  primaryButton,
} from "./ModalFrame";

export function ScaleModal({ bench, onClose, onSubmit }) {
  const [form, setForm] = useState({ replicas: "2", scope: "workers" });
  const replicas = Number(form.replicas);
  const valid = Number.isInteger(replicas) && replicas >= 1 && replicas <= 20;

  return (
    <ModalFrame
      title="scale"
      hint="ajustar workers do bench no FMX"
      onClose={onClose}
      footer={
        <>
          <span className="text-[9px] uppercase tracking-[0.16em] text-overlay0">
            {bench ? `alvo: ${bench.name}` : "nenhum bench selecionado"}
          </span>
          <div className="flex gap-2">
            <button type="button" className={ghostButton} onClick={onClose}>
              cancelar
            </button>
            <button
              type="submit"
              form="scale-form"
              className={primaryButton}
              disabled={!valid || !bench}
            >
              aplicar no fmx
            </button>
          </div>
        </>
      }
    >
      <form
        id="scale-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || !bench) return;
          onSubmit({ replicas, scope: form.scope });
        }}
        className="space-y-3"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="scale-replicas">
              réplicas (1–20)
            </label>
            <input
              id="scale-replicas"
              className={inputClass}
              value={form.replicas}
              inputMode="numeric"
              onChange={(event) =>
                setForm((prev) => ({ ...prev, replicas: event.target.value }))
              }
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="scale-scope">
              escopo
            </label>
            <select
              id="scale-scope"
              className={inputClass}
              value={form.scope}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, scope: event.target.value }))
              }
            >
              <option value="workers">background workers (RQ)</option>
              <option value="web">web/gunicorn</option>
            </select>
          </div>
        </div>

        <p className="border border-surface0/60 bg-mantle/40 px-3 py-2 text-[10px] leading-relaxed text-sub0">
          {form.scope === "workers"
            ? "fmx shell <bench> -c \"bench set-config -g background_workers N\", depois fmx start --reconfigure-workers e fmx restart --workers --supervisor."
            : "fmx shell <bench> -c \"bench set-config -g gunicorn_workers N\", depois fmx restart --supervisor."}
        </p>
        <p className="text-[9px] leading-relaxed text-overlay0">
          o daemon não usa fmx scale (o comando não existe no Frappe-Manager). A operação é
          assíncrona: acompanhe os eventos em Logs e o status no D1.
        </p>
      </form>
    </ModalFrame>
  );
}
