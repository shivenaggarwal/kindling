import { db, schema } from "../db";

export type JobType =
  | "analyze-project"
  | "propose-segments"
  | "find-leads"
  | "write-sequence"
  | "handle-reply"
  | "send-message";

export async function enqueue(
  type: JobType,
  payload: Record<string, unknown>,
  opts: { projectId?: string | null; runAt?: Date; maxAttempts?: number } = {},
) {
  const [job] = await db
    .insert(schema.jobs)
    .values({
      type,
      payload,
      projectId: opts.projectId ?? null,
      runAt: opts.runAt ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 3,
    })
    .returning();
  return job;
}
