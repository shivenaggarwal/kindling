import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { projectTotals, segmentStats } from "@/lib/pipeline/stats";
import { PerfBadge } from "@/components/status";
import { Card, CardHeader, Empty, MatrixNumber, money, pct, Readouts, Stat } from "@/components/ui";

export const metadata = { title: "Results" };

const PROVIDER: Record<string, string> = { anthropic: "AI (Claude)", gemini: "AI (Gemini)", apollo: "Apollo", hunter: "Hunter", places: "Google Maps" };

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
      <Readouts cols={4}>
        <Stat label="Contacted" value={totals?.contacted ?? 0} />
        <Stat label="Reply rate" value={totals?.contacted ? pct((totals.replies ?? 0) / totals.contacted) : "–"} />
        <Stat label="Warm leads" value={totals?.positive ?? 0} accent={(totals?.positive ?? 0) > 0} />
        <Stat label="Cost per warm lead" value={totals?.positive ? money((totals.cost ?? 0) / totals.positive) : "–"} sub={`${money(totals?.cost ?? 0)} spent in total`} />
      </Readouts>

      <Card className="overflow-hidden">
        <CardHeader
          title="By segment"
          description="Cheapest warm leads first. On autopilot, segments that convert get more leads, and ones that don't get paused."
        />
        {rows.length === 0 ? (
          <div className="px-5 pb-5"><Empty title="No campaigns running">Activate a segment and approve some emails to see results here.</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-y border-border text-left text-[12px] text-muted">
                  <th className="px-5 py-2.5 font-semibold">Segment</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Leads</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Contacted</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Replies</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Warm</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Meetings</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Spend</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Per warm lead</th>
                </tr>
              </thead>
              <tbody className="num divide-y divide-border">
                {rows.map(({ s, st }) => (
                  <tr key={s.id}>
                    <td className="px-5 py-3 font-semibold">{s.name}</td>
                    <td className="px-3 py-3"><PerfBadge performance={s.performance} status={s.status} /></td>
                    <td className="px-3 py-3 text-right">{st.leads}</td>
                    <td className="px-3 py-3 text-right">{st.contacted}</td>
                    <td className="px-3 py-3 text-right">
                      {st.replies}
                      {st.contacted ? <span className="ml-1 text-[12px] text-muted">{pct(st.replies / st.contacted)}</span> : null}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold">{st.positive}</td>
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
        <CardHeader title="Spend by provider" description="Real API costs, logged for every call. Unit prices for Apollo, Hunter and Maps can be changed in the environment." />
        {byProvider.length === 0 ? <p className="px-5 pb-5 text-[14px] text-muted">No spend yet.</p> : null}
        <div className="divide-y divide-border border-t border-border empty:hidden">
          {byProvider.map((p) => (
            <div key={p.provider} className="flex items-baseline justify-between gap-4 px-5 py-3">
              <span className="text-[14px] font-medium">{PROVIDER[p.provider] ?? p.provider}</span>
              <span className="flex items-center gap-4">
                <span className="num text-[13px] text-muted">{p.n} calls</span>
                <MatrixNumber value={money(p.cost)} size={14} className="w-24 justify-end" />
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
