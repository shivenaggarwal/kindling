import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { humanTime } from "@/lib/time";
import { approveReplyAction, discardReply } from "@/lib/actions";
import { AutoRefresh, SubmitButton } from "@/components/client";
import { LeadStatus, ReplyBadge } from "@/components/status";
import { Badge, Card, CardHeader, Empty, Textarea } from "@/components/ui";

export const metadata = { title: "Inbox" };

export default async function InboxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = (await db.query.projects.findFirst({ where: eq(schema.projects.id, id) }))!;

  const inbound = await db
    .select({ m: schema.messages, lead: schema.leads, company: schema.companies })
    .from(schema.messages)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.messages.leadId))
    .leftJoin(schema.companies, eq(schema.companies.id, schema.leads.companyId))
    .where(and(eq(schema.messages.projectId, id), eq(schema.messages.direction, "inbound")))
    .orderBy(desc(schema.messages.sentAt))
    .limit(100);

  const drafts = await db.query.messages.findMany({
    where: and(eq(schema.messages.projectId, id), eq(schema.messages.kind, "reply"), eq(schema.messages.direction, "outbound"), inArray(schema.messages.status, ["draft", "approved", "sending", "sent"])),
    orderBy: desc(schema.messages.createdAt),
  });
  const draftByLead = new Map<string, (typeof drafts)[number]>();
  for (const d of drafts) if (!draftByLead.has(d.leadId)) draftByLead.set(d.leadId, d);

  // One row per lead: their latest message.
  const seen = new Set<string>();
  const threads = inbound.filter(({ lead }) => (seen.has(lead.id) ? false : (seen.add(lead.id), true)));
  const needsAction = threads.filter(({ lead }) => draftByLead.get(lead.id)?.status === "draft");
  const rest = threads.filter(({ lead }) => draftByLead.get(lead.id)?.status !== "draft");
  const unread = threads.some(({ m }) => !m.handled);

  const Row = ({ m, lead, company }: (typeof threads)[number]) => {
    const draft = draftByLead.get(lead.id);
    const meeting = draft?.decision?.action === "book_meeting" && draft.decision.meetingStartIso ? new Date(draft.decision.meetingStartIso) : null;
    return (
      <div className="grid gap-4 p-5 md:grid-cols-[220px_1fr]">
        <div className="min-w-0 text-sm">
          <Link href={`/projects/${id}/leads/${lead.id}`} className="font-medium hover:text-accent">
            {[lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.email}
          </Link>
          <div className="truncate text-xs text-muted">{lead.title}</div>
          <div className="truncate text-xs">{company?.name}</div>
          <div className="mt-2 flex flex-wrap gap-1">
            <ReplyBadge category={m.handled ? m.decision?.category : null} />
            <LeadStatus status={lead.status} />
          </div>
        </div>
        <div className="min-w-0 space-y-3">
          <div className="rounded-lg bg-surface-2/60 p-3.5">
            <div className="mb-1 text-xs text-muted">{m.sentAt ? humanTime(m.sentAt, project.settings.timezone) : ""}</div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</div>
          </div>
          {m.decision?.summary ? <p className="text-xs text-ai">AI read: {m.decision.summary}</p> : null}
          {m.decision?.referralEmail ? (
            <p className="text-xs">Referred to <b>{m.decision.referralName}</b> ({m.decision.referralEmail})</p>
          ) : null}

          {draft?.status === "draft" ? (
            <form action={approveReplyAction.bind(null, draft.id)} className="space-y-2 rounded-lg border border-border p-3.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">Suggested reply</span>
                {meeting ? <Badge tone="success">Books a call: {humanTime(meeting, project.settings.timezone)}</Badge> : null}
              </div>
              <Textarea name="body" defaultValue={draft.body} rows={Math.min(10, draft.body.split("\n").length + 2)} />
              <div className="flex gap-2">
                <SubmitButton size="sm" pendingText={meeting ? "Booking…" : "Sending…"}>{meeting ? "Book & send" : "Approve & send"}</SubmitButton>
                <SubmitButton size="sm" variant="ghost" formAction={discardReply.bind(null, draft.id)}>Discard</SubmitButton>
              </div>
            </form>
          ) : draft && ["approved", "sending", "sent"].includes(draft.status) ? (
            <div className="text-xs text-muted">
              <Badge tone={draft.status === "sent" ? "success" : "info"}>{draft.status === "sent" ? "Replied" : "Reply queued"}</Badge>
              <span className="ml-2 line-clamp-1 inline">{draft.body.slice(0, 120)}</span>
            </div>
          ) : !m.handled ? (
            <div className="text-xs text-muted"><span className="ember-dot mr-1.5 inline-block size-1.5 rounded-full bg-accent" />Reading and drafting a reply…</div>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <AutoRefresh active={unread} />
      {threads.length === 0 ? (
        <Empty title="No replies yet">
          Replies to your outreach show up here with the AI&apos;s read on each one and a suggested answer. Kindling checks
          connected mailboxes every couple of minutes.
        </Empty>
      ) : null}
      {needsAction.length ? (
        <Card>
          <CardHeader title={`Needs your OK (${needsAction.length})`} description="Edit if you like, then send. Meetings are added to your Google Calendar with a Meet link." />
          <div className="divide-y divide-border">{needsAction.map((t) => <Row key={t.m.id} {...t} />)}</div>
        </Card>
      ) : null}
      {rest.length ? (
        <Card>
          <CardHeader title="All replies" />
          <div className="divide-y divide-border">{rest.map((t) => <Row key={t.m.id} {...t} />)}</div>
        </Card>
      ) : null}
    </div>
  );
}
