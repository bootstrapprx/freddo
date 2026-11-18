import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * D1 is exposed as the `DB` Worker binding. The client is created per request by
 * calling this from a server function/route; no database handle is kept in module
 * state, so requests never share a connection across isolates.
 */
export function getDb() {
  if (!env.DB) {
    throw new Error("D1 binding 'DB' is missing. Configure it in wrangler.jsonc.");
  }
  return drizzle(env.DB, { schema });
}
