import Link from "next/link";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { AutoRefresh } from "@/components/client";
import { EmailStatus, LeadStatus, SourceBadge } from "@/components/status";
import { buttonClass, Card, Empty, LinkButton, MatrixNumber, Select } from "@/components/ui";

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
        <Select name="segment" defaultValue={sp.segment ?? ""} className="h-9 w-auto rounded-full bg-surface text-[13px] font-medium" aria-label="Segment">
          <option value="">All segments</option>
          {segs.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
        <Select name="status" defaultValue={sp.status ?? ""} className="h-9 w-auto rounded-full bg-surface text-[13px] font-medium" aria-label="Status">
          {STATUS_FILTERS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </Select>
        <button className={buttonClass("primary", "sm", "h-9")}>Filter</button>
        <span className="ml-auto flex items-end gap-2 text-[13px] leading-none text-muted">
          <MatrixNumber value={n} size={14} className="text-text" /> lead{n === 1 ? "" : "s"}
        </span>
      </form>

      {rows.length === 0 ? (
        <Empty title="No leads yet" action={<LinkButton href={`/projects/${id}/segments`} variant="primary">Go to segments</LinkButton>}>
          Activate a segment and click &ldquo;Find leads&rdquo;. The agent searches every connected source for decision makers.
        </Empty>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-border text-left text-[12px] text-muted">
                  <th className="px-5 pt-4 pb-2.5 font-semibold">Person</th>
                  <th className="px-4 pt-4 pb-2.5 font-semibold">Company</th>
                  <th className="px-4 pt-4 pb-2.5 font-semibold">Email</th>
                  <th className="px-4 pt-4 pb-2.5 font-semibold">Source</th>
                  <th className="px-4 pt-4 pb-2.5 font-semibold">Segment</th>
                  <th className="px-5 pt-4 pb-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(({ lead, company }) => {
                  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
                  return (
                    <tr key={lead.id} className="transition-colors hover:bg-surface-2/60">
                      <td className="px-5 py-3">
                        <Link href={`/projects/${id}/leads/${lead.id}`} className="font-semibold underline-offset-2 hover:underline">
                          {name || <span className="text-muted">Shared inbox</span>}
                        </Link>
                        <div className="max-w-[220px] truncate text-[13px] text-muted">{lead.title ?? ""}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {company ? <img src={`https://www.google.com/s2/favicons?domain=${company.domain}&sz=32`} alt="" className="size-4 rounded" /> : null}
                          <div className="min-w-0">
                            <div className="max-w-[200px] truncate">{company?.name ?? ""}</div>
                            <div className="text-[13px] text-muted">{company?.domain}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="max-w-[230px] truncate text-[13px]">{lead.email}</div>
                        <div className="mt-1"><EmailStatus status={lead.emailStatus} /></div>
                      </td>
                      <td className="px-4 py-3"><SourceBadge source={lead.source} /></td>
                      <td className="max-w-[160px] truncate px-4 py-3 text-[13px] text-muted">{lead.segmentId ? segName.get(lead.segmentId) : ""}</td>
                      <td className="px-5 py-3"><LeadStatus status={lead.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {n > PAGE ? (
        <div className="flex justify-between">
          {page > 1 ? <Link href={qs({ page: String(page - 1) })} className={buttonClass("secondary", "sm")}>Previous page</Link> : <span />}
          {page * PAGE < n ? <Link href={qs({ page: String(page + 1) })} className={buttonClass("secondary", "sm")}>Next page</Link> : null}
        </div>
      ) : null}
    </div>
  );
}
