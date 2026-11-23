import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { projectTotals, segmentStats } from "@/lib/pipeline/stats";
import { PerfBadge } from "@/components/status";
import { Card, CardHeader, Empty, money, pct, Stat } from "@/components/ui";

export const metadata = { title: "Campaigns" };

const PROVIDER: Record<string, string> = { anthropic: "AI (Claude)", apollo: "Apollo", hunter: "Hunter", places: "Google Maps" };

export default async function CampaignsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const segs = await db.select().from(schema.segments).where(eq(schema.segments.projectId, id)).orderBy(desc(schema.segments.fitScore));
  const [stats, totals] = await Promise.all([segmentStats(id), projectTotals(id)]);
  const byProvider = await db
    .select({ provider: schema.usageEvents.provider, cost: sql<number>`sum(${schema.usageEvents.costUsd})::float`, n: sql<number>`count(*)::int` })
    .from(schema.usageEvents)
    .where(eq(schema.usageEvents.projectId, id))
    .groupBy(schema.usageEvents.provider);

  const rows = segs
    .filter((s) => s.status !== "proposed" || (stats.get(s.id)?.leads ?? 0) > 0)
    .map((s) => ({ s, st: stats.get(s.id)! }))
    .sort((a, b) => (a.st.costPerWarmLead ?? Infinity) - (b.st.costPerWarmLead ?? Infinity));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Contacted" value={totals?.contacted ?? 0} />
        <Stat label="Reply rate" value={totals?.contacted ? pct((totals.replies ?? 0) / totals.contacted) : "—"} />
        <Stat label="Warm leads" value={totals?.positive ?? 0} accent />
        <Stat label="Cost per warm lead" value={totals?.positive ? money((totals.cost ?? 0) / totals.positive) : "—"} sub={`${money(totals?.cost ?? 0)} total`} />
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Campaigns by segment"
          description="Cheapest warm leads first. On autopilot, segments that convert get more leads, and ones that don't get paused."
        />
        {rows.length === 0 ? (
          <div className="p-5"><Empty title="No campaigns running">Activate a segment and approve some emails to see results here.</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-5 py-2.5 font-medium">Segment</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 text-right font-medium">Leads</th>
                  <th className="px-3 py-2.5 text-right font-medium">Contacted</th>
                  <th className="px-3 py-2.5 text-right font-medium">Replies</th>
                  <th className="px-3 py-2.5 text-right font-medium">Warm</th>
                  <th className="px-3 py-2.5 text-right font-medium">Meetings</th>
                  <th className="px-3 py-2.5 text-right font-medium">Spend</th>
                  <th className="px-5 py-2.5 text-right font-medium">Cost / warm lead</th>
                </tr>
              </thead>
              <tbody className="num divide-y divide-border">
                {rows.map(({ s, st }) => (
                  <tr key={s.id}>
                    <td className="px-5 py-3 font-medium">{s.name}</td>
                    <td className="px-3 py-3"><PerfBadge performance={s.performance} status={s.status} /></td>
                    <td className="px-3 py-3 text-right">{st.leads}</td>
                    <td className="px-3 py-3 text-right">{st.contacted}</td>
                    <td className="px-3 py-3 text-right">
                      {st.replies}
                      {st.contacted ? <span className="ml-1 text-xs text-muted">({pct(st.replies / st.contacted)})</span> : null}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-accent">{st.positive}</td>
                    <td className="px-3 py-3 text-right">{st.meetings}</td>
                    <td className="px-3 py-3 text-right">{money(st.cost)}</td>
                    <td className="px-5 py-3 text-right font-semibold">{money(st.costPerWarmLead)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Spend by provider" description="Real API costs, logged for every call. Unit prices for Apollo, Hunter and Maps can be adjusted in .env." />
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {byProvider.length === 0 ? <p className="text-sm text-muted">No spend yet.</p> : null}
          {byProvider.map((p) => (
            <div key={p.provider} className="rounded-lg bg-surface-2/60 p-3">
              <div className="text-xs text-muted">{PROVIDER[p.provider] ?? p.provider}</div>
              <div className="num mt-0.5 text-lg font-semibold">{money(p.cost)}</div>
              <div className="num text-xs text-muted">{p.n} calls</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
