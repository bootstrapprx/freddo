import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { benches, costAllocations, deployments, nodes, settings as settingsTable } from "@/db/schema";
import { auth } from "@/lib/auth";
import { requireUser } from "@/lib/auth-middleware";
import {
  sampleAllocations,
  sampleBenches,
  sampleDeployments,
  sampleNodes,
  sampleSettings,
} from "@/lib/fmxSample";

const shortText = z.string().trim().min(1).max(120);

const nodeInput = z.object({
  name: shortText,
  ip: z.string().trim().min(3).max(45),
  provider: z.string().trim().max(80).optional().or(z.literal("")),
  region: z.string().trim().max(120).optional().or(z.literal("")),
  vcpu: z.coerce.number().int().min(1).max(1024),
  ram_gb: z.coerce.number().min(0.5).max(4096),
  monthly_cost: z.coerce.number().min(0).max(1_000_000),
  currency: z.enum(["USD", "BRL", "EUR"]).default("USD"),
  ssh_user: z.string().trim().max(64).optional().or(z.literal("")),
});

const benchInput = z.object({
  node_id: shortText,
  name: shortText,
  env_tag: z.enum(["dev", "staging", "production"]).default("dev"),
  cpu_pct: z.coerce.number().min(0).max(100),
  ram_pct: z.coerce.number().min(0).max(100),
  port: z.coerce.number().int().min(1).max(65535).default(8080),
  domain: z.string().trim().max(200).optional(),
  site_name: z.string().trim().max(200).optional(),
  frappe_version: z.string().trim().max(40).optional(),
});

const deploymentInput = z.object({
  bench_id: shortText,
  kind: z.enum(["migrate", "build", "deploy"]),
});

function now() {
  return new Date().toISOString();
}

// D1 accepts at most 100 bound parameters per statement. Each allocation row has
// 8 columns, so a single multi-row INSERT with the full sample would be rejected.
const MAX_BIND_PARAMETERS = 100;

async function insertInBatches(db, table, rows) {
  if (!rows.length) return;
  const columnsPerRow = Object.keys(rows[0]).length;
  const batchSize = Math.max(1, Math.floor(MAX_BIND_PARAMETERS / columnsPerRow));
  for (let index = 0; index < rows.length; index += batchSize) {
    await db.insert(table).values(rows.slice(index, index + batchSize)).onConflictDoNothing();
  }
}

async function hasRows(db, table, column, value) {
  const rows = await db.select({ id: table.id }).from(table).where(eq(column, value)).limit(1);
  return rows.length > 0;
}

// The sample dataset is the demo seed for a new account. It lives in D1 after the
// first load, so subsequent edits and reloads are real persisted rows. Each table
// is checked independently so a failed batch can be retried on the next load.
async function seedIfEmpty(db, ownerId) {
  const stamp = now();
  const nodeIds = new Map(sampleNodes.map((item) => [item.id, `${ownerId}-${item.id}`]));
  const benchIds = new Map(sampleBenches.map((item) => [item.id, `${ownerId}-${item.id}`]));
  const benchToNode = new Map(sampleBenches.map((item) => [item.id, item.node_id]));

  if (!(await hasRows(db, nodes, nodes.owner_id, ownerId))) {
    await insertInBatches(
      db,
      nodes,
      sampleNodes.map((item) => ({
        ...item,
        id: nodeIds.get(item.id),
        owner_id: ownerId,
        created_date: stamp,
        updated_date: stamp,
      })),
    );
  }

  if (!(await hasRows(db, benches, benches.owner_id, ownerId))) {
    await insertInBatches(
      db,
      benches,
      sampleBenches.map((item) => ({
        ...item,
        id: benchIds.get(item.id),
        node_id: nodeIds.get(item.node_id),
        owner_id: ownerId,
        created_date: stamp,
        updated_date: stamp,
      })),
    );
  }

  if (!(await hasRows(db, deployments, deployments.owner_id, ownerId))) {
    await insertInBatches(
      db,
      deployments,
      sampleDeployments.map((item) => ({
        ...item,
        id: `${ownerId}-${item.id}`,
        bench_id: benchIds.get(item.bench_id),
        bench_name: sampleBenches.find((bench) => bench.id === item.bench_id)?.name ?? null,
        owner_id: ownerId,
      })),
    );
  }

  if (!(await hasRows(db, settingsTable, settingsTable.owner_id, ownerId))) {
    await db.insert(settingsTable).values({
      id: `${ownerId}-default`,
      owner_id: ownerId,
      ...sampleSettings,
    }).onConflictDoNothing();
  }

  if (!(await hasRows(db, costAllocations, costAllocations.owner_id, ownerId))) {
    await insertInBatches(
      db,
      costAllocations,
      sampleAllocations.map((item) => ({
        id: `${ownerId}-${item.bench_id}-${item.date}`,
        owner_id: ownerId,
        bench_id: benchIds.get(item.bench_id),
        node_id: nodeIds.get(benchToNode.get(item.bench_id)),
        date: item.date,
        cpu_pct: 0,
        ram_pct: 0,
        allocated_cost: item.allocated_cost,
      })),
    );
  }
}

async function assertBenchOwner(db, ownerId, benchId) {
  const rows = await db
    .select({ id: benches.id })
    .from(benches)
    .where(and(eq(benches.id, benchId), eq(benches.owner_id, ownerId)))
    .limit(1);
  if (!rows.length) throw new Error("Bench não encontrado");
}

export const getSessionFn = createServerFn({ method: "GET" }).handler(async () => {
  const session = await auth.api.getSession({ headers: getRequestHeaders() });
  if (!session) return null;
  return { user: session.user, session: session.session };
});

export const loadControlPlaneFn = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const db = getDb();
    const ownerId = context.user.id;
    await seedIfEmpty(db, ownerId);

    const [nodeRows, benchRows, deploymentRows, allocationRows, settingRows] = await Promise.all([
      db.select().from(nodes).where(eq(nodes.owner_id, ownerId)).orderBy(desc(nodes.created_date)),
      db.select().from(benches).where(eq(benches.owner_id, ownerId)).orderBy(desc(benches.created_date)),
      db.select().from(deployments).where(eq(deployments.owner_id, ownerId)).orderBy(desc(deployments.created_date)),
      db.select().from(costAllocations).where(eq(costAllocations.owner_id, ownerId)).orderBy(costAllocations.date),
      db.select().from(settingsTable).where(eq(settingsTable.owner_id, ownerId)).limit(1),
    ]);

    return {
      nodes: nodeRows,
      benches: benchRows,
      deployments: deploymentRows,
      allocations: allocationRows,
      settings: settingRows[0] ?? { id: `${ownerId}-default`, owner_id: ownerId, ...sampleSettings },
    };
  });

export const createNodeFn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(nodeInput)
  .handler(async ({ data, context }) => {
    const stamp = now();
    const [row] = await getDb()
      .insert(nodes)
      .values({
        id: crypto.randomUUID(),
        owner_id: context.user.id,
        status: "online",
        currency: data.currency,
        created_date: stamp,
        updated_date: stamp,
        name: data.name,
        ip: data.ip,
        provider: data.provider || null,
        region: data.region || null,
        vcpu: data.vcpu,
        ram_gb: data.ram_gb,
        monthly_cost: data.monthly_cost,
        ssh_user: data.ssh_user || null,
      })
      .returning();
    return row;
  });

export const createBenchFn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(benchInput)
  .handler(async ({ data, context }) => {
    const db = getDb();
    const node = await db
      .select({ id: nodes.id })
      .from(nodes)
      .where(and(eq(nodes.id, data.node_id), eq(nodes.owner_id, context.user.id)))
      .limit(1);
    if (!node.length) throw new Error("Node não encontrado");

    const stamp = now();
    const [row] = await db
      .insert(benches)
      .values({
        id: crypto.randomUUID(),
        owner_id: context.user.id,
        node_id: data.node_id,
        name: data.name,
        port: data.port,
        domain: data.domain || null,
        site_name: data.site_name || null,
        frappe_version: data.frappe_version || null,
        env_tag: data.env_tag,
        status: "provisioning",
        cpu_pct: data.cpu_pct,
        ram_pct: data.ram_pct,
        created_date: stamp,
        updated_date: stamp,
      })
      .returning();
    return row;
  });

export const createDeploymentFn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(deploymentInput)
  .handler(async ({ data, context }) => {
    const db = getDb();
    await assertBenchOwner(db, context.user.id, data.bench_id);
    const [row] = await db
      .insert(deployments)
      .values({
        id: crypto.randomUUID(),
        owner_id: context.user.id,
        bench_id: data.bench_id,
        kind: data.kind,
        status: "success",
        duration_s: 38.4,
        summary: `${data.kind} concluído · v15.42.1`,
        created_date: now(),
      })
      .returning();
    return row;
  });
