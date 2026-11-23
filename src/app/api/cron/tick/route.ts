import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { scheduledTick } from "@/lib/jobs/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Scheduler entrypoint for serverless hosting. Called by Vercel Cron and/or
 * the GitHub Actions schedule. Responds immediately; the work continues in after().
 */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  after(async () => {
    try {
      const r = await scheduledTick(270_000);
      console.log("[cron] tick done", r);
    } catch (e) {
      console.error("[cron] tick failed", e);
    }
  });
  return Response.json({ ok: true, at: new Date().toISOString() });
}
