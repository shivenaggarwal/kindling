import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { activity } from "../log";
import { enqueue } from "../jobs/queue";
import { POSITIVE_CATEGORIES } from "../types";
import { unsentLeadCount } from "./leads";

export type SegmentStats = {
  segmentId: string;
  leads: number;
  contacted: number;
  replies: number;
  positive: number;
  meetings: number;
  cost: number;
  costPerWarmLead: number | null;
  positiveRate: number;
};

const positiveList = sql.raw(POSITIVE_CATEGORIES.map((c) => `'${c}'`).join(","));

export async function segmentStats(projectId: string): Promise<Map<string, SegmentStats>> {
  const rows = await db.execute<{
    segment_id: string;
    leads: number;
    contacted: number;
    replies: number;
    positive: number;
    meetings: number;
    cost: number;
  }>(sql`
    select s.id as segment_id,
      (select count(*)::int from leads l where l.segment_id = s.id) as leads,
      (select count(distinct m.lead_id)::int from messages m
        where m.segment_id = s.id and m.direction = 'outbound' and m.kind = 'sequence' and m.status = 'sent') as contacted,
      (select count(distinct m.lead_id)::int from messages m
        where m.segment_id = s.id and m.direction = 'inbound'
          and coalesce(m.decision->>'category', '') not in ('bounce', 'out_of_office')) as replies,
      (select count(distinct m.lead_id)::int from messages m
        where m.segment_id = s.id and m.direction = 'inbound' and m.decision->>'category' in (${positiveList})) as positive,
      (select count(*)::int from meetings mt where mt.segment_id = s.id) as meetings,
      (select coalesce(sum(u.cost_usd), 0)::float from usage_events u where u.segment_id = s.id) as cost
    from segments s where s.project_id = ${projectId}
  `);
  const out = new Map<string, SegmentStats>();
  for (const r of rows) {
    out.set(r.segment_id, {
      segmentId: r.segment_id,
      leads: r.leads,
      contacted: r.contacted,
      replies: r.replies,
      positive: r.positive,
      meetings: r.meetings,
      cost: r.cost,
      costPerWarmLead: r.positive > 0 ? r.cost / r.positive : null,
      positiveRate: r.contacted > 0 ? r.positive / r.contacted : 0,
    });
  }
  return out;
}

export async function projectTotals(projectId: string) {
  const [row] = await db.execute<{
    leads: number;
    contacted: number;
    sent: number;
    replies: number;
    positive: number;
    meetings: number;
    cost: number;
    drafts: number;
    pending_replies: number;
  }>(sql`
    select
      (select count(*)::int from leads where project_id = ${projectId}) as leads,
      (select count(distinct lead_id)::int from messages where project_id = ${projectId} and direction='outbound' and status='sent') as contacted,
      (select count(*)::int from messages where project_id = ${projectId} and direction='outbound' and status='sent') as sent,
      (select count(distinct lead_id)::int from messages where project_id = ${projectId} and direction='inbound'
        and coalesce(decision->>'category','') not in ('bounce','out_of_office')) as replies,
      (select count(distinct lead_id)::int from messages where project_id = ${projectId} and direction='inbound'
        and decision->>'category' in (${positiveList})) as positive,
      (select count(*)::int from meetings where project_id = ${projectId}) as meetings,
      (select coalesce(sum(cost_usd),0)::float from usage_events where project_id = ${projectId}) as cost,
      (select count(distinct lead_id)::int from messages where project_id = ${projectId} and kind='sequence' and status='draft') as drafts,
      (select count(*)::int from messages where project_id = ${projectId} and kind='reply' and status='draft') as pending_replies
  `);
  return row;
}

/**
 * Classify each active segment by results, and on autopilot act on it:
 * pause segments that aren't converting, top up leads for ones that are.
 */
export async function optimizeProject(projectId: string) {
  const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
  if (!project) return;
  const segs = await db.query.segments.findMany({ where: eq(schema.segments.projectId, projectId) });
  const stats = await segmentStats(projectId);

  for (const seg of segs) {
    const st = stats.get(seg.id);
    if (!st) continue;
    let perf = "testing";
    if (st.contacted >= 25) {
      if (st.positiveRate >= 0.04) perf = "scaling";
      else if (st.positiveRate >= 0.015) perf = "working";
      else if (st.contacted >= 50 && st.positive === 0) perf = "underperforming";
    }
    if (perf !== seg.performance) {
      await db.update(schema.segments).set({ performance: perf }).where(eq(schema.segments.id, seg.id));
    }
    if (!project.autopilot || seg.status !== "active") continue;

    if (perf === "underperforming") {
      await db.update(schema.segments).set({ status: "paused" }).where(eq(schema.segments.id, seg.id));
      await activity(projectId, `Autopilot paused ${seg.name}: ${st.contacted} contacted, no positive replies`, "warning");
    } else if ((perf === "scaling" || perf === "working" || perf === "testing") && !seg.findingLeads) {
      const left = await unsentLeadCount(seg.id);
      // Keep a buffer of leads ready for active segments; scale winners harder.
      if (left < (perf === "scaling" ? 20 : 8)) {
        const claimed = await db
          .update(schema.segments)
          .set({ findingLeads: true })
          .where(and(eq(schema.segments.id, seg.id), eq(schema.segments.findingLeads, false)))
          .returning({ id: schema.segments.id });
        if (claimed.length) {
          await enqueue("find-leads", { segmentId: seg.id }, { projectId });
          await activity(projectId, `Autopilot: finding more leads for ${seg.name} (${perf})`);
        }
      }
    }
  }
}
