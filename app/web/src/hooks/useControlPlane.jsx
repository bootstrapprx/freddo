import { useCallback, useEffect, useMemo, useState } from "react";
import { allocatedCost, forecast, utilization } from "@/lib/finops";
import {
  sampleAllocations,
  sampleBenches,
  sampleDeployments,
  sampleNodes,
  sampleSettings,
  seedLogs,
} from "@/lib/fmxSample";

const MAX_SERIES = 36;

// Local control-plane state. The data source is swapped for server functions backed
// by D1 without changing this hook's public shape.
export function useControlPlane() {
  const [nodes, setNodes] = useState(sampleNodes);
  const [benches, setBenches] = useState(sampleBenches);
  const [deployments, setDeployments] = useState(sampleDeployments);
  const [settings] = useState(sampleSettings);
  const [expanded, setExpanded] = useState(() => new Set(sampleNodes.map((node) => node.id)));
  const [selectedId, setSelectedId] = useState(sampleBenches[0]?.id ?? null);
  const [tab, setTab] = useState("logs");
  const [modal, setModal] = useState(null);
  const [running, setRunning] = useState(false);
  const [clock, setClock] = useState("");
  const [tick, setTick] = useState(0);
  const [liveHistory, setLiveHistory] = useState(() =>
    Object.fromEntries(
      sampleBenches.map((bench) => [
        bench.id,
        {
          cpu: Array.from({ length: MAX_SERIES }, (_, i) => clamp(bench.cpu_pct + Math.sin((i + bench.name.length) / 3) * 4)),
          ram: Array.from({ length: MAX_SERIES }, (_, i) => clamp(bench.ram_pct + Math.cos((i + bench.name.length) / 4) * 3)),
        },
      ]),
    ),
  );

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
    if (!running) return undefined;
    const timer = setTimeout(() => {
      setDeployments((current) => [
        {
          id: `d-${Date.now()}`,
          bench_id: selectedId,
          kind: "migrate",
          status: "success",
          duration_s: 38.4,
          created_date: new Date().toISOString(),
          summary: "migrate concluído · v15.42.1",
        },
        ...current,
      ]);
      setRunning(false);
    }, 2600);
    return () => clearTimeout(timer);
  }, [running, selectedId]);

  useEffect(() => {
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
    sampleAllocations.forEach((row) => {
      byDate.set(row.date, (byDate.get(row.date) ?? 0) + Number(row.allocated_cost || 0));
    });
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, cost]) => ({ date, cost }));
  }, []);

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
  const runMigration = useCallback(() => setRunning(true), []);

  const addNode = useCallback((values) => {
    const id = `n-${Date.now()}`;
    setNodes((current) => [
      ...current,
      {
        id,
        status: "online",
        ssh_user: "root",
        currency: "USD",
        vcpu: Number(values.vcpu) || 2,
        ram_gb: Number(values.ram_gb) || 4,
        ...values,
      },
    ]);
    setExpanded((current) => new Set([...current, id]));
  }, []);

  const addBench = useCallback((values) => {
    const nodeId = values.node_id || nodes[0]?.id;
    const bench = {
      id: `b-${Date.now()}`,
      node_id: nodeId,
      port: Number(values.port) || 8080,
      status: "provisioning",
      env_tag: values.env_tag || "dev",
      cpu_pct: Number(values.cpu_pct) || 0,
      ram_pct: Number(values.ram_pct) || 0,
      ...values,
    };
    setBenches((current) => [...current, bench]);
    setSelectedId(bench.id);
  }, [nodes]);

  return {
    nodes,
    benches,
    deployments,
    allocations: sampleAllocations,
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
