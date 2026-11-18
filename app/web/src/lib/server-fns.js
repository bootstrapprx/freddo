import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
  actionLogs,
  benches,
  costAllocations,
  deployments,
  nodes,
  settings as settingsTable,
  telemetrySamples,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { requireUser } from "@/lib/auth-middleware";
import {
  collectDaemonTelemetry,
  daemonSettings,
  getDaemonHealth,
  getDaemonOperation,
  startDaemonOperation,
} from "@/lib/fmxDaemon";
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
  apps: z.array(shortText).min(1).max(10).optional(),
});

const deploymentInput = z.object({
  bench_id: shortText,
  kind: z.enum(["migrate", "build", "deploy"]),
  target: z.enum(["site", "infra", "all"]).default("site"),
});

const scaleInput = z.object({
  bench_id: shortText,
  replicas: z.coerce.number().int().min(1).max(20),
  scope: z.enum(["workers", "web"]).default("workers"),
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
    await db
      .insert(settingsTable)
      .values({
        id: `${ownerId}-default`,
        owner_id: ownerId,
        ...sampleSettings,
      })
      .onConflictDoNothing();
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
    .select()
    .from(benches)
    .where(and(eq(benches.id, benchId), eq(benches.owner_id, ownerId)))
    .limit(1);
  if (!rows.length) throw new Error("Bench não encontrado");
  return rows[0];
}

function normalizeEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.map((event, index) => ({
    t: event.time || event.t || now(),
    level: event.level || "INFO",
    msg: event.message || event.msg || `evento ${index + 1}`,
  }));
}

function parseStoredLogs(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [{ t: now(), level: "INFO", msg: String(raw) }];
  }
}

function durationBetween(start, end) {
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, (to - from) / 1000);
}

function normalizeDaemonResult(result) {
  if (!result.ok) {
    return { ok: false, error: result.error || "daemon indisponível", data: {} };
  }
  const data = result.data || {};
  return {
    ok: true,
    data,
    operationId: data.operation_id || result.envelope?.operation_id || null,
    status: data.status || result.envelope?.status || "succeeded",
  };
}

async function recordActionLog(db, ownerId, entry) {
  const [row] = await db
    .insert(actionLogs)
    .values({
      id: crypto.randomUUID(),
      owner_id: ownerId,
      bench_id: entry.benchId ?? null,
      kind: entry.kind,
      status: entry.status,
      operation_id: entry.operationId ?? null,
      provider: entry.provider ?? "fmx-control",
      summary: entry.summary ?? null,
      logs: JSON.stringify(entry.logs ?? []),
      created_date: now(),
    })
    .returning();
  return row;
}

async function daemonView() {
  const config = daemonSettings();
  const base = {
    url: config.url,
    authenticated: config.authenticated,
    telemetryIntervalMs: config.telemetryIntervalMs,
  };
  const result = await getDaemonHealth();
  if (!result.ok) {
    return {
      ...base,
      online: false,
      provider: "unknown",
      mode: "offline",
      available: false,
      docker: false,
      compose: false,
      error: result.error,
    };
  }
  const data = result.data || {};
  return {
    ...base,
    online: true,
    provider: data.provider || "unknown",
    mode: data.mode || "unknown",
    available: Boolean(data.available),
    docker: Boolean(data.docker?.ok),
    compose: Boolean(data.compose?.ok),
    version: data.version || null,
    command: data.command || null,
    fmx: data.fmx?.text || null,
    error: null,
  };
}

async function syncOperations(db, ownerId) {
  const [pendingDeployments, pendingActions, pendingBenches] = await Promise.all([
    db
      .select()
      .from(deployments)
      .where(and(eq(deployments.owner_id, ownerId), eq(deployments.status, "running"))),
    db
      .select()
      .from(actionLogs)
      .where(and(eq(actionLogs.owner_id, ownerId), eq(actionLogs.status, "running"))),
    db
      .select()
      .from(benches)
      .where(and(eq(benches.owner_id, ownerId), eq(benches.status, "provisioning"))),
  ]);

  const pending = [
    ...pendingDeployments.map((row) => ({ ...row, table: "deployment" })),
    ...pendingActions.map((row) => ({ ...row, table: "action" })),
    ...pendingBenches.map((row) => ({ ...row, table: "bench" })),
  ].filter((row) => row.operation_id);

  const seen = new Set();
  for (const row of pending) {
    if (seen.has(row.operation_id)) continue;
    seen.add(row.operation_id);

    const result = await getDaemonOperation(row.operation_id);
    if (!result.ok) continue;
    const operation = result.data;
    if (!operation || operation.status === "running") continue;

    const status = operation.status === "succeeded" ? "success" : "failed";
    const logs = normalizeEvents(operation.events);
    const summary = operation.summary || row.summary || status;
    const duration = durationBetween(operation.created_at, operation.finished_at);

    if (pendingDeployments.some((item) => item.id === row.id && row.table === "deployment")) {
      await db
        .update(deployments)
        .set({ status, summary, logs: JSON.stringify(logs), duration_s: duration })
        .where(and(eq(deployments.id, row.id), eq(deployments.owner_id, ownerId)));
    }
    if (pendingActions.some((item) => item.id === row.id && row.table === "action")) {
      await db
        .update(actionLogs)
        .set({ status, summary, logs: JSON.stringify(logs) })
        .where(and(eq(actionLogs.id, row.id), eq(actionLogs.owner_id, ownerId)));
    }
    if (pendingBenches.some((item) => item.id === row.id && row.table === "bench")) {
      let nextStatus = null;
      if (operation.kind === "create-bench") nextStatus = status === "success" ? "running" : "failed";
      else if (operation.kind === "scale") nextStatus = status === "success" ? "running" : "degraded";
      else if (operation.kind === "migrate") nextStatus = status === "success" ? "running" : "degraded";
      if (nextStatus) {
        await db
          .update(benches)
          .set({ status: nextStatus, updated_date: now() })
          .where(and(eq(benches.id, row.id), eq(benches.owner_id, ownerId)));
      }
    }
  }
}

async function collectTelemetry(db, ownerId) {
  const config = daemonSettings();
  const [last] = await db
    .select({ collected_at: telemetrySamples.collected_at })
    .from(telemetrySamples)
    .where(eq(telemetrySamples.owner_id, ownerId))
    .orderBy(desc(telemetrySamples.collected_at))
    .limit(1);

  if (last && Date.now() - Date.parse(last.collected_at) < config.telemetryIntervalMs) {
    return { ok: true, skipped: true, samples: 0 };
  }

  const benchRows = await db
    .select({
      id: benches.id,
      name: benches.name,
      node_id: benches.node_id,
      status: benches.status,
    })
    .from(benches)
    .where(eq(benches.owner_id, ownerId));
  if (!benchRows.length) return { ok: true, skipped: true, samples: 0 };

  const result = await collectDaemonTelemetry(
    benchRows.map((bench) => ({
      id: bench.id,
      name: bench.name,
      node_id: bench.node_id,
    })),
  );

  if (!result.ok) {
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const [recent] = await db
      .select({ id: actionLogs.id })
      .from(actionLogs)
      .where(
        and(
          eq(actionLogs.owner_id, ownerId),
          eq(actionLogs.kind, "telemetry"),
          gt(actionLogs.created_date, since),
        ),
      )
      .limit(1);
    if (!recent) {
      await recordActionLog(db, ownerId, {
        kind: "telemetry",
        status: "failed",
        summary: result.error || "coleta de telemetria falhou",
        logs: [{ t: now(), level: "ERROR", msg: result.error || "daemon indisponível" }],
      });
    }
    return { ok: false, error: result.error, samples: 0 };
  }

  const samples = (result.data?.samples || []).filter((sample) => sample.source === "docker");
  if (samples.length) {
    const stamp = result.data?.collected_at || now();
    await insertInBatches(
      db,
      telemetrySamples,
      samples.map((sample) => ({
        id: `${ownerId}-${sample.bench_id}-${stamp}`,
        owner_id: ownerId,
        bench_id: sample.bench_id,
        node_id: sample.node_id,
        cpu_pct: sample.cpu_pct,
        ram_pct: sample.ram_pct,
        source: sample.source,
        collected_at: stamp,
      })),
    );
    for (const sample of samples) {
      await db
        .update(benches)
        .set({
          cpu_pct: sample.cpu_pct,
          ram_pct: sample.ram_pct,
          telemetry_source: sample.source,
          updated_date: now(),
        })
        .where(and(eq(benches.id, sample.bench_id), eq(benches.owner_id, ownerId)));
    }
  }

  return { ok: true, samples: samples.length, available: Boolean(result.data?.available) };
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
    await syncOperations(db, ownerId);
    const telemetryStatus = await collectTelemetry(db, ownerId);

    const [nodeRows, benchRows, deploymentRows, allocationRows, settingRows, telemetryRows, actionRows] =
      await Promise.all([
        db.select().from(nodes).where(eq(nodes.owner_id, ownerId)).orderBy(desc(nodes.created_date)),
        db.select().from(benches).where(eq(benches.owner_id, ownerId)).orderBy(desc(benches.created_date)),
        db
          .select()
          .from(deployments)
          .where(eq(deployments.owner_id, ownerId))
          .orderBy(desc(deployments.created_date)),
        db
          .select()
          .from(costAllocations)
          .where(eq(costAllocations.owner_id, ownerId))
          .orderBy(costAllocations.date),
        db.select().from(settingsTable).where(eq(settingsTable.owner_id, ownerId)).limit(1),
        db
          .select()
          .from(telemetrySamples)
          .where(eq(telemetrySamples.owner_id, ownerId))
          .orderBy(desc(telemetrySamples.collected_at))
          .limit(500),
        db
          .select()
          .from(actionLogs)
          .where(eq(actionLogs.owner_id, ownerId))
          .orderBy(desc(actionLogs.created_date))
          .limit(100),
      ]);

    return {
      nodes: nodeRows,
      benches: benchRows,
      deployments: deploymentRows,
      allocations: allocationRows,
      settings: settingRows[0] ?? { id: `${ownerId}-default`, owner_id: ownerId, ...sampleSettings },
      telemetry: telemetryRows,
      actionLogs: actionRows,
      telemetryStatus,
      daemon: await daemonView(),
    };
  });

export const createNodeFn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(nodeInput)
  .handler(async ({ data, context }) => {
    const stamp = now();
    const daemon = normalizeDaemonResult(
      await startDaemonOperation("/v1/nodes", {
        name: data.name,
        host: data.ip,
      }),
    );
    const ready = daemon.ok ? Boolean(daemon.data?.ready) : false;
    const db = getDb();

    const [row] = await db
      .insert(nodes)
      .values({
        id: crypto.randomUUID(),
        owner_id: context.user.id,
        status: ready ? "online" : "unmanaged",
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

    await recordActionLog(db, context.user.id, {
      kind: "node",
      benchId: null,
      status: daemon.ok && ready ? "success" : "failed",
      summary: daemon.ok
        ? `node ${data.name} ${ready ? "validado" : "registrado sem FMX/Docker"}`
        : `node ${data.name} registrado sem preflight: ${daemon.error}`,
      logs: normalizeEvents(daemon.data?.checks?.map((check) => ({
        time: stamp,
        level: check.ok ? "OK" : "WARN",
        message: `${check.name}: ${check.detail || (check.ok ? "ok" : "indisponível")}`,
      }))),
    });

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
    const daemon = normalizeDaemonResult(
      await startDaemonOperation("/v1/benches", {
        name: data.name,
        apps: data.apps?.length ? data.apps : ["erpnext"],
        environment: data.env_tag === "dev" ? "dev" : "prod",
        site: data.site_name || `${data.name}.localhost`,
      }),
    );

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
        status: daemon.operationId ? "provisioning" : "unmanaged",
        operation_id: daemon.operationId,
        telemetry_source: "seed",
        cpu_pct: data.cpu_pct,
        ram_pct: data.ram_pct,
        created_date: stamp,
        updated_date: stamp,
      })
      .returning();

    await recordActionLog(db, context.user.id, {
      kind: "provision",
      benchId: row.id,
      status: daemon.operationId ? "running" : "failed",
      operationId: daemon.operationId,
      summary: daemon.operationId
        ? `provisionamento de ${data.name} iniciado no FMX`
        : `provisionamento não iniciado: ${daemon.error}`,
      logs: daemon.ok
        ? []
        : [{ t: stamp, level: "ERROR", msg: daemon.error }],
    });

    return row;
  });

export const createDeploymentFn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(deploymentInput)
  .handler(async ({ data, context }) => {
    const db = getDb();
    const bench = await assertBenchOwner(db, context.user.id, data.bench_id);
    const stamp = now();

    const daemon = normalizeDaemonResult(
      await startDaemonOperation(
        `/v1/benches/${encodeURIComponent(bench.name)}/migrations`,
        {
          target: data.target,
          site: bench.site_name || bench.name,
        },
      ),
    );

    const [row] = await db
      .insert(deployments)
      .values({
        id: crypto.randomUUID(),
        owner_id: context.user.id,
        bench_id: bench.id,
        bench_name: bench.name,
        kind: data.kind,
        status: daemon.operationId ? "running" : "failed",
        operation_id: daemon.operationId,
        provider: "fmx-control",
        duration_s: 0,
        summary: daemon.operationId
          ? `${data.target} iniciado no FMX`
          : `daemon indisponível: ${daemon.error}`,
        logs: JSON.stringify(
          daemon.ok ? [] : [{ t: stamp, level: "ERROR", msg: daemon.error }],
        ),
        created_date: stamp,
      })
      .returning();

    return row;
  });

export const scaleBenchFn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator(scaleInput)
  .handler(async ({ data, context }) => {
    const db = getDb();
    const bench = await assertBenchOwner(db, context.user.id, data.bench_id);
    const stamp = now();

    const daemon = normalizeDaemonResult(
      await startDaemonOperation(
        `/v1/benches/${encodeURIComponent(bench.name)}/workers/concurrency`,
        { replicas: data.replicas, scope: data.scope },
      ),
    );

    const row = await recordActionLog(db, context.user.id, {
      kind: "scale",
      benchId: bench.id,
      status: daemon.operationId ? "running" : "failed",
      operationId: daemon.operationId,
      summary: daemon.operationId
        ? `${data.scope} → ${data.replicas} réplica(s) iniciado no FMX`
        : `escala não iniciada: ${daemon.error}`,
      logs: daemon.ok ? [] : [{ t: stamp, level: "ERROR", msg: daemon.error }],
    });

    if (daemon.operationId) {
      await db
        .update(benches)
        .set({ status: "provisioning", updated_date: stamp })
        .where(and(eq(benches.id, bench.id), eq(benches.owner_id, context.user.id)));
    }

    return row;
  });

export const collectTelemetryFn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const db = getDb();
    return collectTelemetry(db, context.user.id);
  });
