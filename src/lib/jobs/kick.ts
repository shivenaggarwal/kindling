import { after } from "next/server";
import { drainJobs } from "./drain";
import { sendNow } from "./tick";

/** True when there's no separate worker process (e.g. on Vercel). */
export const inlineJobs = () => process.env.VERCEL === "1" || process.env.INLINE_JOBS === "1";

// Leave headroom under the function's 300s limit.
const BUDGET_MS = 270_000;

/**
 * After the response is sent, start working on what the user just asked for
 * instead of waiting for the next scheduled tick. No-op when a worker runs.
 */
export function kick(opts: { jobs?: boolean; send?: boolean } = { jobs: true }) {
  if (!inlineJobs()) return;
  after(async () => {
    try {
      if (opts.send) await sendNow();
      if (opts.jobs) await drainJobs({ budgetMs: BUDGET_MS });
    } catch (e) {
      console.error("[kick]", e);
    }
  });
}
