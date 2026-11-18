import { base44 } from "@/api/base44Client";

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
      base44.entities.FmxNode.filter({}, { sort: "-created_date", limit: 100 }),
      base44.entities.FmxBench.filter({}, { sort: "-created_date", limit: 200 }),
      base44.entities.FmxDeployment.filter({}, { sort: "-created_date", limit: 50 }),
      base44.entities.FmxCostAllocation.filter({}, { sort: "date", limit: 500 }),
      base44.entities.FmxSettings.filter({}, { limit: 1 }),
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
  return base44.entities.FmxNode.create(stripId(node));
}

export async function createBenchRecord(bench) {
  return base44.entities.FmxBench.create(stripId(bench));
}

export async function createDeploymentRecord(deployment) {
  return base44.entities.FmxDeployment.create(stripId(deployment));
}