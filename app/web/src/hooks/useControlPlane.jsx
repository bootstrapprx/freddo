import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { allocatedCost, forecast, utilization } from "@/lib/finops";
import {
  collectTelemetry,
  controlPlaneQuery,
  createBench,
  createDeployment,
  createNode,
  scaleBench,
} from "@/lib/fmxRepo";
import { sampleSettings } from "@/lib/fmxSample";

const EMPTY = {
  nodes: [],
  benches: [],
  deployments: [],
  allocations: [],
  telemetry: [],
  actionLogs: [],
  settings: sampleSettings,
  daemon: {
    online: false,
    provider: "unknown",
    mode: "offline",
    docker: false,
    error: "daemon não consultado",
  },
};

function parseLogLines(raw) {
  if (!raw) return [];
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [{ t: "", level: "INFO", msg: raw }];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.map((line) => ({
    t: line.t || String(line.time || "").slice(11, 19) || "",
    level: line.level || "INFO",
    msg: line.msg || line.message || "",
  }));
}

function levelForStatus(status) {
  if (status === "success") return "OK";
  if (status === "failed") return "ERROR";
  return "INFO";
}

export function useControlPlane() {
  const queryClient = useQueryClient();
  const { data = EMPTY } = useQuery(controlPlaneQuery);
  const nodes = data.nodes ?? [];
  const benches = data.benches ?? [];
  const deployments = data.deployments ?? [];
  const allocations = data.allocations ?? [];
  const settings = data.settings ?? sampleSettings;
  const telemetry = data.telemetry ?? [];
  const actionLogs = data.actionLogs ?? [];
  const daemon = data.daemon ?? EMPTY.daemon;
  const telemetryStatus = data.telemetryStatus ?? null;

  const [expanded, setExpanded] = useState(() => new Set());
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState("logs");
  const [modal, setModal] = useState(null);
  const [clock, setClock] = useState("");

  useEffect(() => {
    setExpanded(new Set(nodes.map((node) => node.id)));
    setSelectedId((current) =>
      benches.some((bench) => bench.id === current) ? current : (benches[0]?.id ?? null),
    );
  }, [nodes, benches]);

  useEffect(() => {
    const update = () =>
      setClock(
        new Date().toLocaleTimeString("pt-BR", { hour12: false, timeZone: "UTC" }),
      );
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: controlPlaneQuery.queryKey }),
    [queryClient],
  );

  const tree = useMemo(
    () => nodes.map((node) => ({ node, benches: benches.filter((bench) => bench.node_id === node.id) })),
    [nodes, benches],
  );

  const selectedBench = useMemo(
    () => benches.find((bench) => bench.id === selectedId) ?? null,
    [benches, selectedId],
  );
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedBench?.node_id) ?? null,
    [nodes, selectedBench],
  );

  // Histórico vem apenas das amostras persistidas pelo daemon (docker stats).
  // Sem container/daemon não há série: não existe telemetria simulada.
  const telemetryByBench = useMemo(() => {
    const map = new Map();
    const ascending = [...telemetry].sort((a, b) =>
      String(a.collected_at).localeCompare(String(b.collected_at)),
    );
    ascending.forEach((sample) => {
      if (!map.has(sample.bench_id)) map.set(sample.bench_id, { cpu: [], ram: [] });
      const entry = map.get(sample.bench_id);
      entry.cpu.push(Number(sample.cpu_pct) || 0);
      entry.ram.push(Number(sample.ram_pct) || 0);
    });
    return map;
  }, [telemetry]);

  const live = useMemo(() => {
    const result = {};
    benches.forEach((bench) => {
      result[bench.id] = {
        cpu: Number(bench.cpu_pct) || 0,
        ram: Number(bench.ram_pct) || 0,
        source: bench.telemetry_source || "seed",
      };
    });
    return result;
  }, [benches]);

  const series = useMemo(
    () => telemetryByBench.get(selectedId) ?? { cpu: [], ram: [] },
    [telemetryByBench, selectedId],
  );

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
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, cost]) => ({ date, cost }));
  }, [allocations]);

  const forecastData = useMemo(() => forecast(history), [history]);

  // Logs persistidos: cada deploy/ação virou linha no D1 com os eventos do daemon.
  const logs = useMemo(() => {
    if (!selectedBench) return [];
    const records = [
      ...deployments.filter((item) => item.bench_id === selectedBench.id),
      ...actionLogs.filter((item) => item.bench_id === selectedBench.id),
    ];
    const lines = records.flatMap((item) => {
      const time = String(item.created_date || "").slice(11, 19);
      const header = {
        t: time,
        level: levelForStatus(item.status),
        msg: `${item.kind} · ${item.summary || item.status}${item.operation_id ? ` · ${item.operation_id}` : ""}`,
      };
      return [header, ...parseLogLines(item.logs)];
    });
    return lines.sort((a, b) => String(a.t).localeCompare(String(b.t))).slice(-80);
  }, [selectedBench, deployments, actionLogs]);

  const running = useMemo(() => {
    if (!selectedBench) return false;
    return (
      deployments.some(
        (item) => item.bench_id === selectedBench.id && item.status === "running",
      ) ||
      actionLogs.some(
        (item) => item.bench_id === selectedBench.id && item.status === "running",
      ) ||
      selectedBench.status === "provisioning"
    );
  }, [selectedBench, deployments, actionLogs]);

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
    await createDeployment({ bench_id: selectedId, kind: "migrate", target: "site" });
    await invalidate();
  }, [selectedId, invalidate]);

  const runScale = useCallback(
    async (values) => {
      if (!selectedId) return;
      await scaleBench({ bench_id: selectedId, ...values });
      await invalidate();
    },
    [selectedId, invalidate],
  );

  const refreshTelemetry = useCallback(async () => {
    await collectTelemetry();
    await invalidate();
  }, [invalidate]);

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
    runScale,
    daemon,
    telemetry,
    telemetryStatus,
    actionLogs,
    refreshTelemetry,
  };
}
