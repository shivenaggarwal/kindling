import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { renderBody } from "@/lib/pipeline/write";
import { approveLead, regenerateSequence, retryMessage, setLeadStatus, skipLead, updateMessage } from "@/lib/actions";
import { AutoRefresh, SubmitButton } from "@/components/client";
import { EmailStatus, LeadStatus, ReplyBadge, SourceBadge } from "@/components/status";
import { Badge, Card, CardHeader, Input, Textarea } from "@/components/ui";

const STEP_LABEL = ["Email 1", "Follow-up 1", "Follow-up 2"];

export default async function LeadPage({ params }: { params: Promise<{ id: string; leadId: string }> }) {
  const { id, leadId } = await params;
  const lead = await db.query.leads.findFirst({ where: eq(schema.leads.id, leadId) });
  if (!lead || lead.projectId !== id) notFound();
  const project = (await db.query.projects.findFirst({ where: eq(schema.projects.id, id) }))!;
  const [company, segment, msgs, meetings] = await Promise.all([
    lead.companyId ? db.query.companies.findFirst({ where: eq(schema.companies.id, lead.companyId) }) : null,
    lead.segmentId ? db.query.segments.findFirst({ where: eq(schema.segments.id, lead.segmentId) }) : null,
    db.query.messages.findMany({
      where: eq(schema.messages.leadId, leadId),
      orderBy: asc(sql`coalesce(${schema.messages.sentAt}, ${schema.messages.createdAt})`),
    }),
    db.query.meetings.findMany({ where: eq(schema.meetings.leadId, leadId) }),
  ]);

  const sequence = msgs.filter((m) => m.kind === "sequence" && m.status !== "sent").sort((a, b) => a.step - b.step);
  const history = msgs.filter((m) => m.status === "sent" || m.status === "received");
  const hasDrafts = sequence.some((m) => m.status === "draft");
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.email;

  return (
    <div className="space-y-5">
      <AutoRefresh active={lead.status === "new" || lead.status === "drafting"} />
      <Link href={`/projects/${id}/leads`} className="text-sm text-muted hover:text-text">← All leads</Link>

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-3xl">{name}</h2>
              <p className="text-sm text-muted">
                {lead.title ?? "Unknown title"} · {company?.name ?? "—"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {hasDrafts ? (
                <form action={approveLead.bind(null, leadId)}>
                  <SubmitButton size="sm">Approve sequence</SubmitButton>
                </form>
              ) : null}
              {["drafted", "error", "paused"].includes(lead.status) ? (
                <form action={regenerateSequence.bind(null, leadId)}>
                  <SubmitButton size="sm" variant="secondary" pendingText="Queued…">Rewrite</SubmitButton>
                </form>
              ) : null}
              {!["paused", "bounced", "unsubscribed"].includes(lead.status) ? (
                <form action={skipLead.bind(null, leadId)}>
                  <SubmitButton size="sm" variant="ghost" confirm="Stop all outreach to this lead?">Skip lead</SubmitButton>
                </form>
              ) : null}
            </div>
          </div>

          {lead.status === "new" || lead.status === "drafting" ? (
            <Card className="p-5 text-sm text-muted">
              <span className="ember-dot mr-2 inline-block size-2 rounded-full bg-accent" />
              Researching {company?.domain ?? "the company"} and writing a personal sequence…
            </Card>
          ) : null}

          {sequence.length ? (
            <Card>
              <CardHeader
                title="Sequence"
                description={
                  hasDrafts
                    ? "Edit anything, then approve. Follow-ups go in the same thread if there's no reply."
                    : "Approved. Sends inside your sending window. Follow-ups stop automatically on reply."
                }
              />
              <div className="divide-y divide-border">
                {sequence.map((m) => (
                  <form key={m.id} action={updateMessage.bind(null, m.id)} className="space-y-2 p-5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold">{STEP_LABEL[m.step] ?? `Step ${m.step + 1}`}</span>
                        <Badge tone={m.status === "approved" || m.status === "queued" ? "success" : m.status === "failed" ? "danger" : m.status === "cancelled" ? "neutral" : "info"}>
                          {m.status === "queued" ? "queued in Instantly" : m.status}
                        </Badge>
                        {m.scheduledAt && m.status === "approved" ? (
                          <span className="text-xs text-muted">due {m.scheduledAt.toLocaleString()}</span>
                        ) : null}
                      </div>
                      {m.status === "failed" ? (
                        <SubmitButton size="sm" variant="secondary" formAction={retryMessage.bind(null, m.id)}>Retry</SubmitButton>
                      ) : null}
                    </div>
                    {m.error ? <p className="text-xs text-danger">{m.error}</p> : null}
                    {m.step === 0 ? <Input name="subject" defaultValue={m.subject} aria-label="Subject" /> : null}
                    <Textarea name="body" defaultValue={m.body} rows={Math.min(14, Math.max(4, m.body.split("\n").length + 2))} disabled={!["draft", "approved", "failed"].includes(m.status)} />
                    {["draft", "approved", "failed"].includes(m.status) ? (
                      <div className="flex justify-end">
                        <SubmitButton size="sm" variant="ghost" pendingText="Saving…">Save edits</SubmitButton>
                      </div>
                    ) : null}
                  </form>
                ))}
              </div>
              <details className="border-t border-border">
                <summary className="cursor-pointer list-none px-5 py-3 text-xs text-muted hover:text-text">Preview with signature ▸</summary>
                <pre className="whitespace-pre-wrap px-5 pb-5 font-sans text-sm leading-relaxed">
                  {`Subject: ${sequence[0]?.subject}\n\n${renderBody(sequence[0]?.body ?? "", project.settings)}`}
                </pre>
              </details>
            </Card>
          ) : null}

          {history.length ? (
            <Card>
              <CardHeader title="Conversation" />
              <div className="divide-y divide-border">
                {history.map((m) => (
                  <div key={m.id} className={m.direction === "inbound" ? "bg-accent-soft/40 p-5" : "p-5"}>
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span className="font-medium text-text">{m.direction === "inbound" ? name : `You (${m.fromEmail ?? ""})`}</span>
                      <span>{(m.sentAt ?? m.createdAt).toLocaleString()}</span>
                      {m.direction === "inbound" ? <ReplyBadge category={m.decision?.category} /> : null}
                      {m.kind === "sequence" ? <Badge>{STEP_LABEL[m.step]}</Badge> : null}
                    </div>
                    {m.step === 0 && m.direction === "outbound" && m.kind === "sequence" ? <div className="mb-1 text-sm font-medium">{m.subject}</div> : null}
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</div>
                    {m.decision?.summary && m.direction === "inbound" ? <p className="mt-2 text-xs text-ai">AI read: {m.decision.summary}</p> : null}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card className="space-y-3 p-5 text-sm">
            <div className="flex flex-wrap gap-1.5">
              <LeadStatus status={lead.status} />
              <SourceBadge source={lead.source} />
            </div>
            <div>
              <div className="text-xs text-muted">Email</div>
              <div className="break-all font-mono text-xs">{lead.email}</div>
              <div className="mt-1"><EmailStatus status={lead.emailStatus} /></div>
            </div>
            {lead.linkedinUrl ? (
              <a href={lead.linkedinUrl} target="_blank" rel="noreferrer" className="block text-xs text-accent hover:underline">LinkedIn ↗</a>
            ) : null}
            {segment ? (
              <div>
                <div className="text-xs text-muted">Segment</div>
                <div>{segment.name}</div>
              </div>
            ) : null}
            {meetings.map((mt) => (
              <div key={mt.id} className="rounded-lg bg-success-soft p-3 text-success">
                <div className="text-xs font-semibold">Meeting booked</div>
                <div className="text-xs">{mt.startAt.toLocaleString()}</div>
                {mt.meetLink ? <a href={mt.meetLink} className="text-xs underline" target="_blank" rel="noreferrer">Join link</a> : null}
              </div>
            ))}
            {["replied", "interested", "contacted"].includes(lead.status) ? (
              <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
                <form action={setLeadStatus.bind(null, leadId, "meeting")}><SubmitButton size="sm" variant="secondary">Mark meeting</SubmitButton></form>
                <form action={setLeadStatus.bind(null, leadId, "not_interested")}><SubmitButton size="sm" variant="ghost">Not interested</SubmitButton></form>
              </div>
            ) : null}
          </Card>

          {company ? (
            <Card className="space-y-3 p-5 text-sm">
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`https://www.google.com/s2/favicons?domain=${company.domain}&sz=32`} alt="" className="size-4 rounded" />
                <a href={`https://${company.domain}`} target="_blank" rel="noreferrer" className="font-medium hover:text-accent">{company.name} ↗</a>
              </div>
              {company.location ? <div className="text-xs text-muted">{company.location}</div> : null}
              {company.phone ? <div className="text-xs text-muted">{company.phone}</div> : null}
              {company.research.whyFit ? (
                <div>
                  <div className="text-xs text-muted">Why they fit</div>
                  <p className="mt-0.5">{company.research.whyFit}</p>
                </div>
              ) : null}
              {company.research.evidenceUrl ? (
                <a href={company.research.evidenceUrl} target="_blank" rel="noreferrer" className="block truncate text-xs text-accent hover:underline">
                  Source ↗
                </a>
              ) : null}
              <div className="flex flex-wrap gap-1">{company.sources.map((s) => <SourceBadge key={s} source={s} />)}</div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
