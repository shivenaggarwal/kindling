import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const after = new URL(request.url).searchParams.get("after");
  const afterDate = after ? new Date(after) : new Date(0);

  const items = await db
    .select({
      id: schema.activities.id,
      level: schema.activities.level,
      message: schema.activities.message,
      createdAt: schema.activities.createdAt,
    })
    .from(schema.activities)
    .where(and(eq(schema.activities.projectId, id), gt(schema.activities.createdAt, Number.isNaN(afterDate.getTime()) ? new Date(0) : afterDate)))
    .orderBy(desc(schema.activities.createdAt))
    .limit(50);

  const busyJob = await db.query.jobs.findFirst({
    where: and(eq(schema.jobs.projectId, id), inArray(schema.jobs.status, ["queued", "running"])),
  });

  return Response.json({
    items: items.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })),
    busy: Boolean(busyJob),
  });
}
