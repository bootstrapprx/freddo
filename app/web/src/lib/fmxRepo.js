import { queryOptions } from "@tanstack/react-query";
import {
  createBenchFn,
  createDeploymentFn,
  createNodeFn,
  loadControlPlaneFn,
} from "@/lib/server-fns";

export const controlPlaneQuery = queryOptions({
  queryKey: ["control-plane"],
  queryFn: () => loadControlPlaneFn(),
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
