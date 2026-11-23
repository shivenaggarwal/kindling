import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Reuse one connection pool across hot reloads in dev.
const globalForDb = globalThis as unknown as { __kindlingSql?: ReturnType<typeof postgres> };

const url = process.env.DATABASE_URL ?? "postgres://localhost:5432/kindling";
const serverless = process.env.VERCEL === "1";

const sql =
  globalForDb.__kindlingSql ??
  postgres(url, {
    max: serverless ? 5 : 10,
    idle_timeout: serverless ? 10 : 30,
    connect_timeout: 15,
    // Pooled connection strings (Neon "-pooler", PgBouncer) run in transaction mode.
    prepare: !/-pooler\.|pgbouncer=true/.test(url),
    onnotice: () => {},
  });
globalForDb.__kindlingSql = sql;

export const db = drizzle(sql, { schema });
export { sql, schema };
