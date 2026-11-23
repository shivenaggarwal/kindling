import { db, schema } from "./db";

type Level = "info" | "success" | "warning" | "error";

/** Write a line to the project's live agent feed. Never throws. */
export async function activity(projectId: string, message: string, level: Level = "info") {
  try {
    await db.insert(schema.activities).values({ projectId, message, level });
  } catch (e) {
    console.error("activity log failed", e);
  }
}

export async function recordUsage(e: {
  projectId?: string | null;
  segmentId?: string | null;
  provider: "anthropic" | "apollo" | "hunter" | "places";
  operation: string;
  units: number;
  costUsd: number;
  meta?: Record<string, unknown>;
}) {
  try {
    await db.insert(schema.usageEvents).values({
      projectId: e.projectId ?? null,
      segmentId: e.segmentId ?? null,
      provider: e.provider,
      operation: e.operation,
      units: e.units,
      costUsd: e.costUsd,
      meta: e.meta ?? {},
    });
  } catch (err) {
    console.error("usage log failed", err);
  }
}
