import { useState } from "react";
import {
  ModalFrame,
  ghostButton,
  inputClass,
  labelClass,
  primaryButton,
} from "./ModalFrame";

const FIELDS = [
  { key: "name", label: "nome do node", placeholder: "atlas-04" },
  { key: "ip", label: "ip público", placeholder: "49.12.84.200" },
  { key: "provider", label: "provedor", placeholder: "Hetzner" },
  { key: "region", label: "região", placeholder: "Falkenstein · DE" },
  { key: "vcpu", label: "vcpu", placeholder: "8" },
  { key: "ram_gb", label: "ram (gb)", placeholder: "32" },
  { key: "monthly_cost", label: "custo mensal (usd)", placeholder: "46.00" },
  { key: "ssh_user", label: "usuário ssh", placeholder: "root" },
];

export function AddNodeModal({ onClose, onSubmit }) {
  const [form, setForm] = useState({
    name: "",
    ip: "",
    provider: "Hetzner",
    region: "",
    vcpu: "4",
    ram_gb: "16",
    monthly_cost: "",
    ssh_user: "root",
  });

  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
  const valid = form.name.trim() && form.ip.trim() && Number(form.monthly_cost) > 0;

  return (
    <ModalFrame
      title="add node"
      hint="registrar VPS no pool"
      onClose={onClose}
      footer={
        <>
          <span className="text-[9px] uppercase tracking-[0.16em] text-overlay0">
            enter salvar · esc cancelar
          </span>
          <div className="flex gap-2">
            <button type="button" className={ghostButton} onClick={onClose}>
              cancelar
            </button>
            <button
              type="submit"
              form="add-node-form"
              className={primaryButton}
              disabled={!valid}
            >
              adicionar node
            </button>
          </div>
        </>
      }
    >
      <form
        id="add-node-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid) return;
          onSubmit(form);
        }}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {FIELDS.map((field) => (
          <div key={field.key}>
            <label className={labelClass} htmlFor={`node-${field.key}`}>
              {field.label}
            </label>
            <input
              id={`node-${field.key}`}
              className={inputClass}
              value={form[field.key]}
              onChange={update(field.key)}
              placeholder={field.placeholder}
              inputMode={["vcpu", "ram_gb", "monthly_cost"].includes(field.key) ? "decimal" : "text"}
            />
          </div>
        ))}
        <p className="sm:col-span-2 text-[9px] leading-relaxed text-overlay0">
          o daemon grava o node em SQLite e passa a amostrar cgroups v2 via SSH na primeira coleta
          de custo.
        </p>
      </form>
    </ModalFrame>
  );
}