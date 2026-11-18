import { createFileRoute, Link } from "@tanstack/react-router";
import { TerminalChrome } from "@/components/fmx/TerminalChrome";
import { StatusBar } from "@/components/fmx/StatusBar";
import { ResourceTree } from "@/components/fmx/ResourceTree";
import { TelemetryPanel } from "@/components/fmx/TelemetryPanel";
import { ShortcutBar } from "@/components/fmx/ShortcutBar";
import { AddNodeModal } from "@/components/fmx/AddNodeModal";
import { WhatIfModal } from "@/components/fmx/WhatIfModal";
import { ScaleModal } from "@/components/fmx/ScaleModal";
import { QuitOverlay } from "@/components/fmx/QuitOverlay";
import { useControlPlane } from "@/hooks/useControlPlane";
import { configFor } from "@/lib/fmxSample";

export const Route = createFileRoute("/_authed/")({
  head: () => ({ meta: [{ title: "FMX · Control Plane & FinOps" }] }),
  component: ControlPlanePage,
});

function ControlPlanePage() {
  const cp = useControlPlane();
  const budget = cp.settings.monthly_budget;
  const currency = cp.settings.currency;
  const source = cp.live[cp.selectedBench?.id]?.source || "seed";
  const daemonLabel = cp.daemon.online
    ? `${cp.daemon.provider} ${cp.daemon.mode} · ${cp.daemon.version || "?"}`
    : "offline";

  const handleAction = (action) => {
    if (action === "migrate") cp.runMigration();
    else cp.openModal(action);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-crust">
      <div className="pointer-events-none absolute inset-0 tui-grid opacity-[0.4]" />
      <div className="pointer-events-none absolute -top-56 left-1/3 h-[640px] w-[640px] rounded-full bg-mauve/10 blur-[170px]" />
      <div className="pointer-events-none absolute -bottom-48 right-0 h-[520px] w-[520px] rounded-full bg-blue/10 blur-[150px]" />

      <main className="relative mx-auto max-w-[1500px] px-3 py-4 sm:px-6 sm:py-7">
        <TerminalChrome title={`fmx@control-plane — ${daemonLabel} — ${cp.clock || "--:--:--"} UTC`}>
          <StatusBar
            totalCost={cp.totalCost}
            budget={budget}
            currency={currency}
            nodeCount={cp.nodes.length}
            benchCount={cp.benches.length}
            clock={cp.clock}
            daemon={cp.daemon}
          />

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,32%)_minmax(0,1fr)]">
            <ResourceTree
              tree={cp.tree}
              expanded={cp.expanded}
              onToggle={cp.toggleNode}
              selectedId={cp.selectedBench?.id}
              onSelect={cp.setSelectedId}
              live={cp.live}
              costs={cp.costs}
              currency={currency}
              nodeCount={cp.nodes.length}
            />

            <TelemetryPanel
              bench={cp.selectedBench}
              node={cp.selectedNode}
              series={cp.selectedSeries}
              live={cp.live[cp.selectedBench?.id] || { cpu: 0, ram: 0 }}
              source={source}
              tab={cp.tab}
              onTab={cp.setTab}
              logs={cp.logs}
              running={cp.running}
              costRows={cp.costRows}
              totalCost={cp.totalCost}
              budget={budget}
              currency={currency}
              configRows={configFor(cp.selectedBench, cp.selectedNode)}
              history={cp.history}
              forecastData={cp.forecastData}
              deployments={cp.deployments.filter(
                (item) => item.bench_id === cp.selectedBench?.id,
              )}
            />
          </div>

          <ShortcutBar tab={cp.tab} onAction={handleAction} online={cp.daemon.online} />
        </TerminalChrome>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-[9px] uppercase tracking-[0.22em] text-overlay0">
          <span>
            provider {cp.daemon.provider} · docker {cp.daemon.docker ? "ok" : "indisponível"} ·
            telemetria {cp.telemetryStatus?.samples ? "docker" : "demo/indisponível"} · D1 fonte da
            verdade
          </span>
          <span className="flex items-center gap-3">
            <button
              type="button"
              onClick={cp.refreshTelemetry}
              className="text-overlay1 transition-colors hover:text-mauve"
            >
              coletar agora ↻
            </button>
            <Link to="/blueprint" className="text-overlay1 transition-colors hover:text-mauve">
              rust blueprint →
            </Link>
          </span>
        </div>
      </main>

      {cp.modal === "add-node" && (
        <AddNodeModal
          onClose={cp.closeModal}
          onSubmit={(values) => {
            cp.addNode(values);
            cp.closeModal();
          }}
        />
      )}

      {cp.modal === "what-if" && (
        <WhatIfModal
          nodes={cp.nodes}
          currency={currency}
          currentTotal={cp.totalCost}
          budget={budget}
          onClose={cp.closeModal}
          onSubmit={(values) => {
            cp.addBench(values);
            cp.closeModal();
          }}
        />
      )}

      {cp.modal === "scale" && (
        <ScaleModal
          bench={cp.selectedBench}
          onClose={cp.closeModal}
          onSubmit={(values) => {
            cp.runScale(values);
            cp.closeModal();
          }}
        />
      )}

      {cp.modal === "quit" && <QuitOverlay onClose={cp.closeModal} />}
    </div>
  );
}
