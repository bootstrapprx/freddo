import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { BLUEPRINT } from "@/lib/rustBlueprint";

export const Route = createFileRoute("/_authed/blueprint")({
  head: () => ({ meta: [{ title: "FMX · Rust Blueprint" }] }),
  component: BlueprintPage,
});

function BlueprintPage() {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const file = BLUEPRINT[active];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(file.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-crust">
      <div className="pointer-events-none absolute inset-0 tui-grid opacity-[0.35]" />
      <main className="relative mx-auto max-w-[1300px] px-3 py-5 sm:px-6 sm:py-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-overlay0">
              <span className="border border-mauve/50 bg-mauve/10 px-1.5 py-0.5 text-mauve">rust</span>
              blueprint do daemon nativo
            </div>
            <h1 className="mt-2 text-[18px] text-ink">fmx-control · cargo run</h1>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-overlay1">
              o control plane web acima é o espelho interativo desta arquitetura. aqui está o
              esqueleto Rust completo: axum + tokio + sqlx/sqlite, wrapper do fmx com fallback para
              mock e a TUI ratatui com a mesma alocação de custo.
            </p>
          </div>
          <Link
            to="/"
            className="border border-surface1 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-sub0 transition-colors hover:border-mauve hover:text-mauve"
          >
            ← control plane
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="border border-surface0/70 bg-base">
            <div className="border-b border-surface0/60 px-3 py-2 text-[9px] uppercase tracking-[0.22em] text-overlay0">
              arquivos
            </div>
            <div className="py-1">
              {BLUEPRINT.map((entry, index) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => setActive(index)}
                  className={`block w-full border-l-2 px-3 py-1.5 text-left transition-colors ${
                    index === active
                      ? "border-mauve bg-mauve/10 text-ink"
                      : "border-transparent text-sub0 hover:bg-surface0/40"
                  }`}
                >
                  <span className="block truncate text-[11px]">{entry.path}</span>
                  <span className="block truncate text-[9px] text-overlay0">{entry.caption}</span>
                </button>
              ))}
            </div>
            <div className="border-t border-surface0/60 px-3 py-2 text-[9px] leading-relaxed text-overlay0">
              <div>$ cargo build --release</div>
              <div>$ cargo run --release</div>
            </div>
          </aside>

          <section className="min-w-0 border border-surface0/70 bg-base">
            <div className="flex items-center justify-between gap-2 border-b border-surface0/70 bg-mantle px-3 py-2">
              <span className="truncate text-[10px] text-sub0">
                <span className="text-overlay0">~/fmx-control/</span>
                {file.path}
              </span>
              <button
                type="button"
                onClick={copy}
                className="shrink-0 border border-surface1 px-2 py-1 text-[9px] uppercase tracking-[0.16em] text-sub0 transition-colors hover:border-mauve hover:text-mauve"
              >
                {copied ? "copiado" : "copiar"}
              </button>
            </div>
            <pre className="max-h-[70vh] overflow-auto px-4 py-3 text-[10.5px] leading-[1.7] text-sub1">
              <code>{file.code}</code>
            </pre>
          </section>
        </div>
      </main>
    </div>
  );
}