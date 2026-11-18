import { authClient } from "@/lib/authClient";

function items(page) {
  if (!page) return [];
  if (Array.isArray(page)) return page;
  return Array.isArray(page.items) ? page.items : [];
}

function stripId(record) {
  const { id, created_date, updated_date, created_by_id, ...rest } = record;
  return rest;
}

export async function loadControlPlane() {
  try {
    const [nodePage, benchPage, deployPage, allocPage, settingsPage] = await Promise.all([
      authClient.entities.FmxNode.filter({}, { sort: "-created_date", limit: 100 }),
      authClient.entities.FmxBench.filter({}, { sort: "-created_date", limit: 200 }),
      authClient.entities.FmxDeployment.filter({}, { sort: "-created_date", limit: 50 }),
      authClient.entities.FmxCostAllocation.filter({}, { sort: "date", limit: 500 }),
      authClient.entities.FmxSettings.filter({}, { limit: 1 }),
    ]);

    return {
      nodes: items(nodePage),
      benches: items(benchPage),
      deployments: items(deployPage),
      allocations: items(allocPage),
      settings: items(settingsPage)[0] || null,
    };
  } catch (error) {
    return { nodes: [], benches: [], deployments: [], allocations: [], settings: null };
  }
}

export async function createNodeRecord(node) {
  return authClient.entities.FmxNode.create(stripId(node));
}

export async function createBenchRecord(bench) {
  return authClient.entities.FmxBench.create(stripId(bench));
}

export async function createDeploymentRecord(deployment) {
  return authClient.entities.FmxDeployment.create(stripId(deployment));
}