import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { AutoRefresh } from "@/components/client";
import { EmailStatus, LeadStatus, SourceBadge } from "@/components/status";
import { Card, Empty, LinkButton, Select } from "@/components/ui";

export const metadata = { title: "Leads" };

const STATUS_FILTERS = [
  ["", "All statuses"],
  ["drafted", "Ready to send"],
  ["contacted", "Contacted"],
  ["interested", "Interested"],
  ["meeting", "Meeting booked"],
  ["replied", "Replied"],
  ["not_interested", "Not interested"],
  ["bounced", "Bounced"],
] as const;

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ segment?: string; status?: string; page?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const PAGE = 100;

  const segs = await db.select({ id: schema.segments.id, name: schema.segments.name }).from(schema.segments).where(eq(schema.segments.projectId, id));
  const segName = new Map(segs.map((s) => [s.id, s.name]));

  const where = and(
    eq(schema.leads.projectId, id),
    sp.segment ? eq(schema.leads.segmentId, sp.segment) : undefined,
    sp.status ? eq(schema.leads.status, sp.status) : undefined,
  );
  const [rows, [{ n }], writing] = await Promise.all([
    db
      .select({ lead: schema.leads, company: schema.companies })
      .from(schema.leads)
      .leftJoin(schema.companies, eq(schema.companies.id, schema.leads.companyId))
      .where(where)
      .orderBy(desc(schema.leads.createdAt))
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.leads).where(where),
    db.query.leads.findFirst({ where: and(eq(schema.leads.projectId, id), inArray(schema.leads.status, ["new", "drafting"])) }),
  ]);

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { segment: sp.segment, status: sp.status, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div className="space-y-4">
      <AutoRefresh active={!!writing} every={5000} />
      <form className="flex flex-wrap items-center gap-2">
        <Select name="segment" defaultValue={sp.segment ?? ""} className="w-auto">
          <option value="">All segments</option>
          {segs.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
        <Select name="status" defaultValue={sp.status ?? ""} className="w-auto">
          {STATUS_FILTERS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </Select>
        <button className="h-9 rounded-lg border border-border bg-surface px-3 text-sm hover:bg-surface-2">Filter</button>
        <span className="num ml-auto text-sm text-muted">{n} lead{n === 1 ? "" : "s"}</span>
      </form>

      {rows.length === 0 ? (
        <Empty title="No leads yet" action={<LinkButton href={`/projects/${id}/segments`} variant="primary">Go to segments</LinkButton>}>
          Activate a segment and click &ldquo;Find leads&rdquo;. The agent searches every connected source for decision makers.
        </Empty>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2/50 text-left text-xs text-muted">
                  <th className="px-4 py-2.5 font-medium">Person</th>
                  <th className="px-4 py-2.5 font-medium">Company</th>
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th className="px-4 py-2.5 font-medium">Segment</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(({ lead, company }) => {
                  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
                  return (
                    <tr key={lead.id} className="hover:bg-surface-2/40">
                      <td className="px-4 py-2.5">
                        <Link href={`/projects/${id}/leads/${lead.id}`} className="font-medium hover:text-accent">
                          {name || <span className="text-muted">Shared inbox</span>}
                        </Link>
                        <div className="max-w-[220px] truncate text-xs text-muted">{lead.title ?? "—"}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {company ? <img src={`https://www.google.com/s2/favicons?domain=${company.domain}&sz=32`} alt="" className="size-4 rounded" /> : null}
                          <div className="min-w-0">
                            <div className="max-w-[200px] truncate">{company?.name ?? "—"}</div>
                            <div className="text-xs text-muted">{company?.domain}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="max-w-[230px] truncate font-mono text-xs">{lead.email}</div>
                        <div className="mt-0.5"><EmailStatus status={lead.emailStatus} /></div>
                      </td>
                      <td className="px-4 py-2.5"><SourceBadge source={lead.source} /></td>
                      <td className="max-w-[160px] truncate px-4 py-2.5 text-xs text-muted">{lead.segmentId ? segName.get(lead.segmentId) : "—"}</td>
                      <td className="px-4 py-2.5"><LeadStatus status={lead.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {n > PAGE ? (
        <div className="flex justify-between text-sm">
          {page > 1 ? <Link href={qs({ page: String(page - 1) })} className="text-muted hover:text-text">← Previous</Link> : <span />}
          {page * PAGE < n ? <Link href={qs({ page: String(page + 1) })} className="text-muted hover:text-text">Next →</Link> : null}
        </div>
      ) : null}
    </div>
  );
}
