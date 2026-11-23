import Link from "next/link";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { localParts } from "@/lib/time";
import { approveAllDrafts, approveLead, regenerateSequence, retryMessage, skipLead } from "@/lib/actions";
import { AutoRefresh, SubmitButton } from "@/components/client";
import { Badge, Card, CardHeader, Empty, LinkButton, Notice, Select } from "@/components/ui";

export const metadata = { title: "Outreach" };

export default async function OutreachPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ segment?: string }>;
}) {
  const { id } = await params;
  const { segment } = await searchParams;
  const project = (await db.query.projects.findFirst({ where: eq(schema.projects.id, id) }))!;
  const segs = await db.select().from(schema.segments).where(eq(schema.segments.projectId, id));
  const segName = new Map(segs.map((s) => [s.id, s.name]));

  const drafts = await db
    .select({ m: schema.messages, lead: schema.leads, company: schema.companies })
    .from(schema.messages)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.messages.leadId))
    .leftJoin(schema.companies, eq(schema.companies.id, schema.leads.companyId))
    .where(
      and(
        eq(schema.messages.projectId, id),
        eq(schema.messages.kind, "sequence"),
        eq(schema.messages.step, 0),
        eq(schema.messages.status, "draft"),
        segment ? eq(schema.messages.segmentId, segment) : undefined,
      ),
    )
    .orderBy(asc(schema.messages.createdAt))
    .limit(50);

  const [queue] = await db
    .select({
      approvedFirst: sql<number>`count(*) filter (where ${schema.messages.status} = 'approved' and ${schema.messages.step} = 0)::int`,
      approvedFollow: sql<number>`count(*) filter (where ${schema.messages.status} = 'approved' and ${schema.messages.step} > 0 and ${schema.messages.scheduledAt} is not null)::int`,
      failed: sql<number>`count(*) filter (where ${schema.messages.status} = 'failed')::int`,
    })
    .from(schema.messages)
    .where(and(eq(schema.messages.projectId, id), eq(schema.messages.direction, "outbound")));

  const sentToday = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .where(and(eq(schema.messages.projectId, id), eq(schema.messages.status, "sent"), sql`${schema.messages.sentAt} > now() - interval '24 hours'`));

  const recent = await db
    .select({ m: schema.messages, lead: schema.leads })
    .from(schema.messages)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.messages.leadId))
    .where(and(eq(schema.messages.projectId, id), eq(schema.messages.direction, "outbound"), inArray(schema.messages.status, ["sent", "failed"])))
    .orderBy(desc(sql`coalesce(${schema.messages.sentAt}, ${schema.messages.createdAt})`))
    .limit(15);

  const mailboxes = await db.select().from(schema.mailboxes).where(eq(schema.mailboxes.active, true));
  const writing = await db.query.leads.findFirst({ where: and(eq(schema.leads.projectId, id), inArray(schema.leads.status, ["new", "drafting"])) });

  const s = project.settings;
  const now = localParts(new Date(), s.timezone);
  const inWindow = s.sendDays.includes(now.weekday) && now.hour >= s.sendWindowStart && now.hour < s.sendWindowEnd;
  const pausedSegs = segs.filter((x) => x.status !== "active").map((x) => x.id);
  const totalDrafts = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .where(and(eq(schema.messages.projectId, id), eq(schema.messages.kind, "sequence"), eq(schema.messages.step, 0), eq(schema.messages.status, "draft")));

  return (
    <div className="space-y-5">
      <AutoRefresh active={!!writing} every={5000} />

      <div className="grid gap-3 md:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-muted">Waiting for review</div>
          <div className="num mt-1 font-display text-3xl">{totalDrafts[0]?.n ?? 0}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Approved, in queue</div>
          <div className="num mt-1 font-display text-3xl">{queue?.approvedFirst ?? 0}</div>
          <div className="text-xs text-muted">+ {queue?.approvedFollow ?? 0} follow-ups scheduled</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Sent in last 24h</div>
          <div className="num mt-1 font-display text-3xl">{sentToday[0]?.n ?? 0}</div>
          <div className="text-xs text-muted">limit {mailboxes.reduce((a, m) => a + m.dailyLimit, 0)}/day across {mailboxes.length} mailbox{mailboxes.length === 1 ? "" : "es"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Sending window</div>
          <div className="mt-1 flex items-center gap-2 text-sm font-medium">
            <span className={inWindow ? "inline-block size-2 rounded-full bg-success" : "inline-block size-2 rounded-full bg-faint"} />
            {inWindow ? "Open now" : "Closed now"}
          </div>
          <div className="text-xs text-muted">
            {s.sendWindowStart}:00–{s.sendWindowEnd}:00 {s.timezone}
          </div>
        </Card>
      </div>

      {mailboxes.length === 0 ? (
        <Notice tone="info">
          No active mailbox. <Link href="/settings" className="font-medium underline">Connect Gmail</Link> and approved emails will start sending.
        </Notice>
      ) : null}
      {(queue?.failed ?? 0) > 0 ? <Notice tone="danger">{queue?.failed} email(s) failed to send. See below.</Notice> : null}

      <Card>
        <CardHeader
          title="Review queue"
          description={project.autopilot ? "Autopilot is on, so new sequences are approved automatically." : "Approve a sequence to queue all three emails. Follow-ups stop the moment someone replies."}
          action={
            drafts.length ? (
              <div className="flex items-center gap-2">
                <form className="flex items-center gap-2">
                  <Select name="segment" defaultValue={segment ?? ""} className="h-8 w-auto text-xs">
                    <option value="">All segments</option>
                    {segs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </Select>
                  <button className="h-8 rounded-lg border border-border px-2.5 text-xs hover:bg-surface-2">Filter</button>
                </form>
                <form action={approveAllDrafts.bind(null, id, segment ?? null)}>
                  <SubmitButton size="sm" confirm={`Approve ${segment ? "all drafts in this segment" : "every draft"}? They'll send within your limits.`}>
                    Approve all
                  </SubmitButton>
                </form>
              </div>
            ) : null
          }
        />
        {drafts.length === 0 ? (
          <div className="p-5">
            <Empty title={writing ? "Writing emails…" : "Nothing to review"}>
              {writing
                ? "The agent is researching each company and writing personal sequences. They'll appear here."
                : "Find leads in a segment and the agent will draft a sequence for each one."}
            </Empty>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {drafts.map(({ m, lead, company }) => (
              <div key={m.id} className="grid gap-4 p-5 md:grid-cols-[220px_1fr]">
                <div className="min-w-0 text-sm">
                  <Link href={`/projects/${id}/leads/${lead.id}`} className="font-medium hover:text-accent">
                    {[lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.email}
                  </Link>
                  <div className="truncate text-xs text-muted">{lead.title}</div>
                  <div className="mt-1 truncate text-xs">{company?.name}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {m.segmentId ? <Badge>{segName.get(m.segmentId)}</Badge> : null}
                    {m.segmentId && pausedSegs.includes(m.segmentId) ? <Badge tone="warning">segment not active</Badge> : null}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{m.subject}</div>
                  <div className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-text/90">{m.body}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <form action={approveLead.bind(null, lead.id)}><SubmitButton size="sm">Approve</SubmitButton></form>
                    <LinkButton href={`/projects/${id}/leads/${lead.id}`} size="sm" variant="secondary">Edit & see follow-ups</LinkButton>
                    <form action={regenerateSequence.bind(null, lead.id)}><SubmitButton size="sm" variant="ghost" pendingText="Queued…">Rewrite</SubmitButton></form>
                    <form action={skipLead.bind(null, lead.id)}><SubmitButton size="sm" variant="ghost">Skip</SubmitButton></form>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {recent.length ? (
        <Card>
          <CardHeader title="Recently sent" />
          <div className="divide-y divide-border">
            {recent.map(({ m, lead }) => (
              <div key={m.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <div className="min-w-0">
                  <Link href={`/projects/${id}/leads/${lead.id}`} className="font-medium hover:text-accent">{lead.email}</Link>
                  <span className="ml-2 text-xs text-muted">{m.kind === "reply" ? "reply" : ["email 1", "follow-up 1", "follow-up 2"][m.step]}</span>
                  {m.error ? <div className="truncate text-xs text-danger">{m.error}</div> : null}
                </div>
                <div className="flex items-center gap-2">
                  {m.status === "failed" ? (
                    <form action={retryMessage.bind(null, m.id)}><SubmitButton size="sm" variant="secondary">Retry</SubmitButton></form>
                  ) : (
                    <span className="num text-xs text-muted">{m.sentAt?.toLocaleString()}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
