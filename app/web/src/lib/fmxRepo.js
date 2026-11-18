import { queryOptions } from "@tanstack/react-query";
import {
  collectTelemetryFn,
  createBenchFn,
  createDeploymentFn,
  createNodeFn,
  loadControlPlaneFn,
  scaleBenchFn,
} from "@/lib/server-fns";

function hasPendingOperation(data) {
  if (!data) return false;
  return (
    data.deployments?.some((item) => item.status === "running") ||
    data.actionLogs?.some((item) => item.status === "running") ||
    data.benches?.some((item) => item.status === "provisioning")
  );
}

export const controlPlaneQuery = queryOptions({
  queryKey: ["control-plane"],
  queryFn: () => loadControlPlaneFn(),
  // Enquanto o daemon executa uma operação, o Worker sincroniza o status no D1;
  // sem operação pendente não há polling (a telemetria tem intervalo próprio).
  refetchInterval: (query) => (hasPendingOperation(query.state.data) ? 1500 : false),
});

export function createNode(values) {
  return createNodeFn({ data: values });
}

export function createBench(values) {
  return createBenchFn({ data: values });
}

export function createDeployment(values) {
  return createDeploymentFn({ data: values });
}

export function scaleBench(values) {
  return scaleBenchFn({ data: values });
}

export function collectTelemetry() {
  return collectTelemetryFn();
}
