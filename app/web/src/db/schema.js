import { relations, sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Better Auth core tables. Column names follow the generated Drizzle schema for
// the email/password + two-factor plugins.
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date())
    .notNull(),
  twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" }).default(false),
  role: text("role").default("user").notNull(),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const twoFactor = sqliteTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    verified: integer("verified", { mode: "boolean" }).default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("twoFactor_secret_idx").on(table.secret),
    index("twoFactor_userId_idx").on(table.userId),
  ],
);

// Control-plane tables, derived from entities/*.jsonc.
export const nodes = sqliteTable("nodes", {
  id: text("id").primaryKey(),
  owner_id: text("owner_id").notNull(),
  name: text("name").notNull(),
  ip: text("ip").notNull(),
  provider: text("provider"),
  region: text("region"),
  vcpu: integer("vcpu").default(0).notNull(),
  ram_gb: real("ram_gb").default(0).notNull(),
  monthly_cost: real("monthly_cost").default(0).notNull(),
  currency: text("currency").default("USD").notNull(),
  status: text("status").default("online").notNull(),
  ssh_user: text("ssh_user"),
  created_date: text("created_date").notNull(),
  updated_date: text("updated_date").notNull(),
});

export const benches = sqliteTable(
  "benches",
  {
    id: text("id").primaryKey(),
    owner_id: text("owner_id").notNull(),
    node_id: text("node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    port: integer("port").default(8080).notNull(),
    domain: text("domain"),
    site_name: text("site_name"),
    frappe_version: text("frappe_version"),
    env_tag: text("env_tag").default("dev").notNull(),
    status: text("status").default("stopped").notNull(),
    cpu_pct: real("cpu_pct").default(0).notNull(),
    ram_pct: real("ram_pct").default(0).notNull(),
    created_date: text("created_date").notNull(),
    updated_date: text("updated_date").notNull(),
  },
  (table) => [index("benches_node_id_idx").on(table.node_id)],
);

export const deployments = sqliteTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    owner_id: text("owner_id").notNull(),
    bench_id: text("bench_id").notNull(),
    bench_name: text("bench_name"),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    duration_s: real("duration_s"),
    summary: text("summary"),
    created_date: text("created_date").notNull(),
  },
  (table) => [index("deployments_bench_id_idx").on(table.bench_id)],
);

export const costAllocations = sqliteTable(
  "cost_allocations",
  {
    id: text("id").primaryKey(),
    owner_id: text("owner_id").notNull(),
    bench_id: text("bench_id").notNull(),
    node_id: text("node_id").notNull(),
    date: text("date").notNull(),
    cpu_pct: real("cpu_pct").default(0).notNull(),
    ram_pct: real("ram_pct").default(0).notNull(),
    allocated_cost: real("allocated_cost").default(0).notNull(),
  },
  (table) => [index("cost_allocations_date_idx").on(table.date)],
);

export const settings = sqliteTable(
  "settings",
  {
    id: text("id").primaryKey(),
    owner_id: text("owner_id").notNull(),
    monthly_budget: real("monthly_budget").default(100).notNull(),
    currency: text("currency").default("USD").notNull(),
    alert_threshold: real("alert_threshold").default(0.8).notNull(),
    billing_cycle: text("billing_cycle").default("monthly").notNull(),
    region: text("region"),
  },
  (table) => [uniqueIndex("settings_owner_id_unique").on(table.owner_id)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  twoFactors: many(twoFactor),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const twoFactorRelations = relations(twoFactor, ({ one }) => ({
  user: one(user, { fields: [twoFactor.userId], references: [user.id] }),
}));
