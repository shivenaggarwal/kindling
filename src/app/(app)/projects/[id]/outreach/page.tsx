import Link from "next/link";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { localParts } from "@/lib/time";
import { env, sendVia } from "@/lib/config";
import * as instantly from "@/lib/instantly/client";
import { approveAllDrafts, approveLead, regenerateSequence, retryMessage, skipLead } from "@/lib/actions";
import { AutoRefresh, SubmitButton } from "@/components/client";
import { Badge, buttonClass, Card, CardHeader, Empty, Led, LinkButton, Notice, Readouts, Select, Stat } from "@/components/ui";

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
      approvedFirst: sql<number>`count(*) filter (where ${schema.messages.status} in ('approved', 'queued') and ${schema.messages.step} = 0)::int`,
      approvedFollow: sql<number>`count(*) filter (where (${schema.messages.status} = 'queued' or (${schema.messages.status} = 'approved' and ${schema.messages.scheduledAt} is not null)) and ${schema.messages.step} > 0)::int`,
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
  const via = sendVia(s);
  let instantlyInfo: { ready: number; warming: number; capacity: number; error?: string } | null = null;
  if (via === "instantly" && env.instantlyKey) {
    try {
      const all = await instantly.listAccounts();
      const allowed = s.instantlyAccounts ?? [];
      const ready = all.filter((a) => instantly.isReady(a) && (!allowed.length || allowed.includes(a.email)));
      instantlyInfo = {
        ready: ready.length,
        warming: all.filter((a) => !instantly.isReady(a) && a.warmup_status === 1).length,
        capacity: ready.reduce((n, a) => n + Math.min(a.daily_limit ?? 30, 50), 0),
      };
    } catch (e) {
      instantlyInfo = { ready: 0, warming: 0, capacity: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }
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

      <Readouts cols={4}>
        <Stat label="Waiting for review" value={totalDrafts[0]?.n ?? 0} accent={(totalDrafts[0]?.n ?? 0) > 0} />
        <Stat label="Approved, in queue" value={queue?.approvedFirst ?? 0} sub={`${queue?.approvedFollow ?? 0} follow-ups scheduled`} />
        <Stat
          label="Sent in 24 hours"
          value={sentToday[0]?.n ?? 0}
          sub={
            via === "instantly"
              ? `Up to ${instantlyInfo?.capacity ?? 0} a day from ${instantlyInfo?.ready ?? 0} warmed mailbox${instantlyInfo?.ready === 1 ? "" : "es"}`
              : `Up to ${mailboxes.reduce((a, m) => a + m.dailyLimit, 0)} a day from ${mailboxes.length} mailbox${mailboxes.length === 1 ? "" : "es"}`
          }
        />
        <div className="min-w-0 px-5 py-4">
          <div className="flex h-[31px] items-center gap-2.5">
            <Led tone={inWindow ? "success" : "neutral"} className="size-2.5" />
            <span className="text-[19px] font-semibold tracking-[-0.02em]">{inWindow ? "Open" : "Closed"}</span>
          </div>
          <div className="mt-2 text-[13px] font-medium">Sending window</div>
          <div className="num mt-0.5 text-[12px] text-muted">
            {s.sendWindowStart}:00 to {s.sendWindowEnd}:00, {s.timezone}
          </div>
        </div>
      </Readouts>

      {via === "instantly" ? (
        !env.instantlyKey ? (
          <Notice tone="warning">
            This project sends through Instantly, but INSTANTLY_API_KEY isn&apos;t set. See <Link href="/infrastructure" className="font-semibold underline underline-offset-2">Sending infrastructure</Link>.
          </Notice>
        ) : instantlyInfo?.error ? (
          <Notice tone="danger">Instantly: {instantlyInfo.error}</Notice>
        ) : (instantlyInfo?.ready ?? 0) === 0 ? (
          <Notice tone="warning">
            No warmed mailboxes yet{instantlyInfo?.warming ? ` (${instantlyInfo.warming} still warming up)` : ""}. Approved emails wait until one is ready.{" "}
            <Link href="/infrastructure" className="font-semibold underline underline-offset-2">Get pre-warmed mailboxes</Link>
          </Notice>
        ) : (
          <Notice tone="success">
            Sending through Instantly from {instantlyInfo?.ready} warmed mailbox{instantlyInfo?.ready === 1 ? "" : "es"}, rotated automatically. Approved
            sequences are handed over within 5 minutes and follow Instantly&apos;s schedule for each segment.
          </Notice>
        )
      ) : mailboxes.length === 0 ? (
        <Notice tone="info">
          No active mailbox. <Link href="/settings" className="font-semibold underline underline-offset-2">Connect Gmail</Link> and approved emails will start sending.
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
                  <Select name="segment" defaultValue={segment ?? ""} className="h-8 w-auto max-w-[200px] rounded-full text-[13px]" aria-label="Segment">
                    <option value="">All segments</option>
                    {segs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </Select>
                  <button className={buttonClass("secondary", "sm")}>Filter</button>
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
          <div className="px-5 pb-5">
            <Empty title={writing ? "Writing emails…" : "Nothing to review"}>
              {writing
                ? "The agent is researching each company and writing personal sequences. They'll appear here."
                : "Find leads in a segment and the agent will draft a sequence for each one."}
            </Empty>
          </div>
        ) : (
          <div className="divide-y divide-border border-t border-border">
            {drafts.map(({ m, lead, company }) => (
              <div key={m.id} className="grid gap-5 p-5 md:grid-cols-[220px_1fr]">
                <div className="min-w-0 text-[14px]">
                  <Link href={`/projects/${id}/leads/${lead.id}`} className="font-semibold underline-offset-2 hover:underline">
                    {[lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.email}
                  </Link>
                  <div className="truncate text-[13px] text-muted">{lead.title}</div>
                  <div className="mt-1 truncate text-[13px]">{company?.name}</div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {m.segmentId ? <Badge>{segName.get(m.segmentId)}</Badge> : null}
                    {m.segmentId && pausedSegs.includes(m.segmentId) ? <Badge tone="warning">Segment paused</Badge> : null}
                  </div>
                </div>
                <div className="min-w-0 rounded-[18px] bg-surface-2 p-4">
                  <div className="text-[15px] font-semibold tracking-[-0.01em]">{m.subject}</div>
                  <div className="mt-2 max-w-[68ch] whitespace-pre-wrap text-[14px] leading-relaxed">{m.body}</div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <form action={approveLead.bind(null, lead.id)}><SubmitButton size="sm">Approve</SubmitButton></form>
                    <LinkButton href={`/projects/${id}/leads/${lead.id}`} size="sm" variant="secondary" className="bg-surface hover:bg-surface-3">Edit and see follow-ups</LinkButton>
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
          <div className="divide-y divide-border border-t border-border">
            {recent.map(({ m, lead }) => (
              <div key={m.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[14px]">
                <div className="flex min-w-0 items-start gap-3">
                  <Led tone={m.status === "failed" ? "danger" : "success"} className="mt-[7px]" />
                  <div className="min-w-0">
                    <Link href={`/projects/${id}/leads/${lead.id}`} className="font-medium underline-offset-2 hover:underline">{lead.email}</Link>
                    <span className="ml-2 text-[13px] text-muted">{m.kind === "reply" ? "Reply" : ["Email 1", "Follow-up 1", "Follow-up 2"][m.step]}</span>
                    {m.error ? <div className="truncate text-[13px] text-danger">{m.error}</div> : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {m.status === "failed" ? (
                    <form action={retryMessage.bind(null, m.id)}><SubmitButton size="sm" variant="secondary">Retry</SubmitButton></form>
                  ) : (
                    <span className="num text-[13px] text-muted">{m.sentAt?.toLocaleString()}</span>
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
