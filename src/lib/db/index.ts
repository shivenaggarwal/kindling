import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Reuse one connection pool across hot reloads in dev.
const globalForDb = globalThis as unknown as { __kindlingSql?: ReturnType<typeof postgres> };

const sql =
  globalForDb.__kindlingSql ??
  postgres(process.env.DATABASE_URL ?? "postgres://localhost:5432/kindling", {
    max: 10,
    idle_timeout: 30,
    onnotice: () => {},
  });
if (process.env.NODE_ENV !== "production") globalForDb.__kindlingSql = sql;

export const db = drizzle(sql, { schema });
export { sql, schema };
