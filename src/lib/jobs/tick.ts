import { db, schema } from "../db";
import { pollReplies } from "../pipeline/replies";
import { sendDue } from "../pipeline/send";
import { syncInstantly } from "../pipeline/instantly";
import { optimizeProject } from "../pipeline/stats";
import { drainJobs } from "./drain";
import { acquireLease, releaseLease } from "./lease";
import { requeueStale } from "./runner";

/**
 * One scheduler run for serverless hosting: send due emails, check for
 * replies, re-score segments, then work through queued jobs.
 */
export async function scheduledTick(budgetMs: number) {
  const started = Date.now();
  // Jobs killed by a function timeout get picked up again.
  await requeueStale(8);

  if (await acquireLease("scheduler", 120_000)) {
    try {
      await sendDue().catch((e) => console.error("[tick] send", e));
      await pollReplies({ minIntervalMs: 90_000 }).catch((e) => console.error("[tick] poll", e));
      await syncInstantly().catch((e) => console.error("[tick] instantly sync", e));
      const projects = await db.select({ id: schema.projects.id }).from(schema.projects);
      for (const p of projects) await optimizeProject(p.id).catch((e) => console.error("[tick] optimize", e));
    } finally {
      await releaseLease("scheduler");
    }
  }

  return drainJobs({ budgetMs: budgetMs - (Date.now() - started) });
}

/** Send whatever is due right now (used right after the user approves something). */
export async function sendNow() {
  if (!(await acquireLease("scheduler", 120_000))) return;
  try {
    await sendDue();
  } finally {
    await releaseLease("scheduler");
  }
}
