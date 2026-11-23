import { claim, execute } from "./runner";

/**
 * Process queued jobs until the time budget runs out. Used on serverless
 * hosts (Vercel), where there's no long-running worker process.
 * Long jobs (web research) only start if there's enough time left to finish.
 */
export async function drainJobs({ budgetMs, concurrency = 4 }: { budgetMs: number; concurrency?: number }) {
  const deadline = Date.now() + budgetMs;
  let active = 0;
  let processed = 0;

  const lane = async () => {
    while (true) {
      const left = deadline - Date.now();
      if (left < 45_000) return;
      const job = await claim({ allowLong: left > 210_000 });
      if (!job) {
        // Jobs still running in this drain may enqueue follow-up work (e.g. find-leads → write-sequence).
        if (active === 0) return;
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      active++;
      try {
        await execute(job);
        processed++;
      } finally {
        active--;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, lane));
  return { processed };
}
