import Anthropic from "@anthropic-ai/sdk";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import type { Job } from "../db/schema";
import { ClaudeRefusal } from "../ai/claude";
import { activity } from "../log";
import { analyzeProject } from "../pipeline/analyze";
import { proposeSegments } from "../pipeline/segments";
import { findLeads } from "../pipeline/leads";
import { writeSequence } from "../pipeline/write";
import { handleReply } from "../pipeline/replies";

async function run(job: Job) {
  const p = job.payload as Record<string, string | number | undefined>;
  switch (job.type) {
    case "analyze-project":
      return analyzeProject(String(p.projectId));
    case "propose-segments":
      return proposeSegments(String(p.projectId));
    case "find-leads":
      return findLeads(String(p.segmentId), p.count ? Number(p.count) : undefined);
    case "write-sequence":
      return writeSequence(String(p.leadId));
    case "handle-reply":
      return handleReply(String(p.messageId));
    default:
      throw new Error(`Unknown job type ${job.type}`);
  }
}

/** Atomically claim the next due job (safe with several workers). */
async function claim(): Promise<Job | null> {
  const rows = await db.execute<{ id: string }>(sql`
    update jobs set status = 'running', locked_at = now(), attempts = attempts + 1
    where id = (
      select id from jobs where status = 'queued' and run_at <= now()
      order by run_at asc limit 1 for update skip locked
    )
    returning id
  `);
  const id = rows[0]?.id;
  if (!id) return null;
  return (await db.query.jobs.findFirst({ where: eq(schema.jobs.id, id) })) ?? null;
}

/** Errors that won't fix themselves on retry (bad credentials, invalid request, refusals). */
function isPermanent(e: unknown) {
  if (e instanceof ClaudeRefusal) return true;
  if (e instanceof Anthropic.APIError && e.status && [400, 401, 403, 404].includes(e.status)) return true;
  return e instanceof Error && /resolve authentication|API key|APP_SECRET/i.test(e.message);
}

function friendly(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (/resolve authentication/i.test(msg)) return "No Claude API key. Add ANTHROPIC_API_KEY to .env and restart.";
  if (e instanceof Anthropic.AuthenticationError) return "Claude rejected the API key. Check ANTHROPIC_API_KEY in .env.";
  return msg;
}

async function onFailure(job: Job, e: unknown) {
  const msg = friendly(e);
  const permanent = isPermanent(e) || job.attempts >= job.maxAttempts;
  console.error(`[job ${job.type}] failed (attempt ${job.attempts}):`, msg);
  await db
    .update(schema.jobs)
    .set(
      permanent
        ? { status: "failed", lastError: msg.slice(0, 2000), finishedAt: new Date() }
        : {
            status: "queued",
            lastError: msg.slice(0, 2000),
            runAt: new Date(Date.now() + 30_000 * 2 ** job.attempts),
          },
    )
    .where(eq(schema.jobs.id, job.id));

  if (permanent && job.projectId) {
    await activity(job.projectId, `${job.type.replace(/-/g, " ")} failed: ${msg}`, "error");
    if (job.type === "analyze-project" || job.type === "propose-segments") {
      await db.update(schema.projects).set({ status: "error", error: msg.slice(0, 1000) }).where(eq(schema.projects.id, job.projectId));
    }
    if (job.type === "find-leads") {
      const segmentId = (job.payload as { segmentId?: string }).segmentId;
      if (segmentId) await db.update(schema.segments).set({ findingLeads: false }).where(eq(schema.segments.id, segmentId));
    }
  }
}

export async function workLoop(slot: number, stop: () => boolean) {
  while (!stop()) {
    let job: Job | null = null;
    try {
      job = await claim();
    } catch (e) {
      console.error("claim failed", e);
    }
    if (!job) {
      await new Promise((r) => setTimeout(r, 1500 + slot * 250));
      continue;
    }
    const started = Date.now();
    try {
      await run(job);
      await db.update(schema.jobs).set({ status: "done", finishedAt: new Date(), lastError: null }).where(eq(schema.jobs.id, job.id));
      console.log(`[job ${job.type}] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (e) {
      await onFailure(job, e);
    }
  }
}

/** Jobs left "running" by a crashed worker go back in the queue. */
export async function requeueStale(minutes = 30) {
  await db.execute(sql`
    update jobs set status = 'queued', locked_at = null
    where status = 'running' and locked_at < now() - make_interval(mins => ${minutes})
  `);
}
