import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { allocatedCost, forecast, utilization } from "@/lib/finops";
import { controlPlaneQuery, createBench, createDeployment, createNode } from "@/lib/fmxRepo";
import { sampleSettings, seedLogs } from "@/lib/fmxSample";

const MAX_SERIES = 36;
const EMPTY = { nodes: [], benches: [], deployments: [], allocations: [], settings: sampleSettings };

export function useControlPlane() {
  const queryClient = useQueryClient();
  const { data = EMPTY } = useQuery(controlPlaneQuery);
  const nodes = data.nodes ?? [];
  const benches = data.benches ?? [];
  const deployments = data.deployments ?? [];
  const allocations = data.allocations ?? [];
  const settings = data.settings ?? sampleSettings;

  const [expanded, setExpanded] = useState(() => new Set());
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState("logs");
  const [modal, setModal] = useState(null);
  const [running, setRunning] = useState(false);
  const [clock, setClock] = useState("");
  const [tick, setTick] = useState(0);
  const [liveHistory, setLiveHistory] = useState({});

  useEffect(() => {
    setExpanded(new Set(nodes.map((node) => node.id)));
    setSelectedId((current) =>
      benches.some((bench) => bench.id === current) ? current : (benches[0]?.id ?? null),
    );
    setLiveHistory(
      Object.fromEntries(
        benches.map((bench) => [
          bench.id,
          {
            cpu: Array.from({ length: MAX_SERIES }, (_, i) => clamp(bench.cpu_pct + Math.sin((i + bench.name.length) / 3) * 4)),
            ram: Array.from({ length: MAX_SERIES }, (_, i) => clamp(bench.ram_pct + Math.cos((i + bench.name.length) / 4) * 3)),
          },
        ]),
      ),
    );
  }, [nodes, benches]);

  useEffect(() => {
    const update = () => setClock(new Date().toLocaleTimeString("pt-BR", { hour12: false, timeZone: "UTC" }));
    update();
    const timer = setInterval(() => {
      update();
      setTick((value) => value + 1);
    }, 1400);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!tick) return;
    setLiveHistory((current) => {
      const next = { ...current };
      benches.forEach((bench) => {
        const history = current[bench.id] ?? { cpu: [], ram: [] };
        const drift = Math.sin((tick + bench.name.length) / 2.6) * 5;
        next[bench.id] = {
          cpu: [...history.cpu, clamp(bench.cpu_pct + drift)].slice(-MAX_SERIES),
          ram: [...history.ram, clamp(bench.ram_pct - drift / 2)].slice(-MAX_SERIES),
        };
      });
      return next;
    });
  }, [tick, benches]);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: controlPlaneQuery.queryKey }),
    [queryClient],
  );

  const tree = useMemo(
    () => nodes.map((node) => ({ node, benches: benches.filter((bench) => bench.node_id === node.id) })),
    [nodes, benches],
  );

  const selectedBench = useMemo(() => benches.find((bench) => bench.id === selectedId) ?? null, [benches, selectedId]);
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedBench?.node_id) ?? null,
    [nodes, selectedBench],
  );

  const live = useMemo(() => {
    const result = {};
    benches.forEach((bench) => {
      const series = liveHistory[bench.id] ?? { cpu: [], ram: [] };
      result[bench.id] = {
        cpu: series.cpu.at(-1) ?? bench.cpu_pct ?? 0,
        ram: series.ram.at(-1) ?? bench.ram_pct ?? 0,
      };
    });
    return result;
  }, [benches, liveHistory]);

  const series = useMemo(() => liveHistory[selectedId] ?? { cpu: [], ram: [] }, [liveHistory, selectedId]);

  const costs = useMemo(() => {
    const result = {};
    benches.forEach((bench) => {
      const node = nodes.find((item) => item.id === bench.node_id);
      const sample = live[bench.id] ?? { cpu: bench.cpu_pct, ram: bench.ram_pct };
      result[bench.id] = allocatedCost(sample.cpu, sample.ram, node);
    });
    return result;
  }, [benches, nodes, live]);

  const costRows = useMemo(
    () =>
      benches.map((bench) => ({
        id: bench.id,
        name: bench.name,
        cost: costs[bench.id] ?? 0,
        util: utilization(live[bench.id]?.cpu, live[bench.id]?.ram),
      })),
    [benches, costs, live],
  );

  const totalCost = useMemo(() => costRows.reduce((sum, row) => sum + row.cost, 0), [costRows]);

  const history = useMemo(() => {
    const byDate = new Map();
    allocations.forEach((row) => {
      byDate.set(row.date, (byDate.get(row.date) ?? 0) + Number(row.allocated_cost || 0));
    });
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, cost]) => ({ date, cost }));
  }, [allocations]);

  const forecastData = useMemo(() => forecast(history), [history]);
  const logs = useMemo(() => seedLogs(selectedBench, selectedNode), [selectedBench, selectedNode]);

  const toggleNode = useCallback((id) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openModal = useCallback((name) => setModal(name), []);
  const closeModal = useCallback(() => setModal(null), []);

  const addNode = useCallback(
    async (values) => {
      await createNode(values);
      await invalidate();
    },
    [invalidate],
  );

  const addBench = useCallback(
    async (values) => {
      const row = await createBench(values);
      await invalidate();
      setSelectedId(row.id);
    },
    [invalidate],
  );

  const runMigration = useCallback(async () => {
    if (!selectedId) return;
    setRunning(true);
    try {
      await createDeployment({ bench_id: selectedId, kind: "migrate" });
      await invalidate();
    } finally {
      setRunning(false);
    }
  }, [selectedId, invalidate]);

  return {
    nodes,
    benches,
    deployments,
    allocations,
    settings,
    tree,
    expanded,
    toggleNode,
    selectedId,
    setSelectedId,
    selectedBench,
    selectedNode,
    live,
    series,
    selectedSeries: series,
    costs,
    costRows,
    totalCost,
    tab,
    setTab,
    logs,
    running,
    history,
    forecastData,
    clock,
    modal,
    openModal,
    closeModal,
    addNode,
    addBench,
    runMigration,
  };
}

function clamp(value) {
  return Math.min(100, Math.max(0, Number(value) || 0));
}
