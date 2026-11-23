import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { drainJobs } from "@/lib/jobs/drain";
import { inlineJobs } from "@/lib/jobs/kick";
import { applyInstantlyEvent, type InstantlyEvent } from "@/lib/pipeline/instantly";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("x-kindling-secret") ?? "";
  if (!secret) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Instantly → Kindling events: sends, replies, bounces, unsubscribes. */
export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let ev: InstantlyEvent;
  try {
    ev = (await request.json()) as InstantlyEvent;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const result = await applyInstantlyEvent(ev);
  // Draft the answer to a new reply right away instead of waiting for the scheduler.
  if (result?.handleReplyId && inlineJobs()) {
    after(() => drainJobs({ budgetMs: 240_000, concurrency: 2 }).catch((e) => console.error("[webhook] drain", e)));
  }
  return Response.json({ ok: true });
}
