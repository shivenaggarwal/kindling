import { sql } from "drizzle-orm";
import { db } from "../db";

/** Try to take a named lease for `ms`. Returns false if someone else holds it. */
export async function acquireLease(name: string, ms: number): Promise<boolean> {
  const rows = await db.execute<{ name: string }>(sql`
    insert into leases (name, expires_at) values (${name}, now() + make_interval(secs => ${ms / 1000}))
    on conflict (name) do update set expires_at = excluded.expires_at
      where leases.expires_at < now()
    returning name
  `);
  return rows.length > 0;
}

export async function releaseLease(name: string) {
  await db.execute(sql`delete from leases where name = ${name}`);
}
