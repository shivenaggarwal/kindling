import "dotenv/config";
import { db, schema, sql } from "../lib/db";
import { requeueStale, workLoop } from "../lib/jobs/runner";
import { sendDue } from "../lib/pipeline/send";
import { pollReplies } from "../lib/pipeline/replies";
import { syncInstantly } from "../lib/pipeline/instantly";
import { optimizeProject } from "../lib/pipeline/stats";
import { APP_NAME } from "../lib/config";

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 4);
let stopping = false;

/** Run `fn` every `ms`, never overlapping with itself. */
function every(name: string, ms: number, fn: () => Promise<unknown>) {
  let running = false;
  const tick = async () => {
    if (running || stopping) return;
    running = true;
    try {
      await fn();
    } catch (e) {
      console.error(`[${name}]`, e);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 2000);
  return setInterval(tick, ms);
}

async function main() {
  console.log(`${APP_NAME} worker starting (concurrency ${CONCURRENCY})`);
  // Anything still "running" belongs to a previous worker process.
  await requeueStale(0);

  const timers = [
    every("send", 45_000, sendDue),
    every("poll-replies", 120_000, () => pollReplies()),
    every("instantly-sync", 120_000, syncInstantly),
    every("optimize", 15 * 60_000, async () => {
      const projects = await db.select({ id: schema.projects.id }).from(schema.projects);
      for (const p of projects) await optimizeProject(p.id);
    }),
    every("requeue-stale", 5 * 60_000, () => requeueStale(30)),
  ];

  const loops = Array.from({ length: CONCURRENCY }, (_, i) => workLoop(i, () => stopping));

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log("worker shutting down…");
    timers.forEach(clearInterval);
    await Promise.race([Promise.all(loops), new Promise((r) => setTimeout(r, 10_000))]);
    await sql.end({ timeout: 5 });
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
