import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { integrations } from "@/lib/config";
import { projectTotals } from "@/lib/pipeline/stats";
import { rerunAnalysis } from "@/lib/actions";
import { ActivityFeed, SubmitButton } from "@/components/client";
import { Badge, Card, CardHeader, LinkButton, money, Notice, Stat } from "@/components/ui";
import { cn } from "@/lib/cn";

export default async function ProjectOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = (await db.query.projects.findFirst({ where: eq(schema.projects.id, id) }))!;
  const [t, feed, busyJob, segs, mailboxes] = await Promise.all([
    projectTotals(id),
    db.select().from(schema.activities).where(eq(schema.activities.projectId, id)).orderBy(desc(schema.activities.createdAt)).limit(40),
    db.query.jobs.findFirst({ where: and(eq(schema.jobs.projectId, id), inArray(schema.jobs.status, ["queued", "running"])) }),
    db.select().from(schema.segments).where(eq(schema.segments.projectId, id)),
    db.select({ id: schema.mailboxes.id }).from(schema.mailboxes),
  ]);
  const p = project.profile;
  const ints = integrations();
  const activeSegs = segs.filter((s) => s.status === "active").length;

  // Pipeline progress, mirroring the six things the agent does.
  const steps = [
    { label: "Learn the business", done: !!p, active: project.status === "analyzing" && !p },
    { label: "Find who buys", done: segs.length > 0, active: !!p && segs.length === 0 && project.status === "analyzing" },
    { label: "Find the people", done: (t?.leads ?? 0) > 0, active: segs.some((s) => s.findingLeads) },
    { label: "Write emails", done: (t?.leads ?? 0) > 0 && (t?.drafts ?? 0) + (t?.sent ?? 0) > 0, active: false },
    { label: "Send & follow up", done: (t?.sent ?? 0) > 0, active: false },
    { label: "Replies & meetings", done: (t?.replies ?? 0) > 0, active: false },
  ];

  const nextStep = !p
    ? null
    : segs.length && activeSegs === 0
      ? { text: "Review the proposed segments and pick where to start.", href: "segments", cta: "Choose segments" }
      : (t?.drafts ?? 0) > 0
        ? { text: `${t?.drafts} personalised sequences are ready for your review.`, href: "outreach", cta: "Review emails" }
        : (t?.pending_replies ?? 0) > 0
          ? { text: `${t?.pending_replies} replies have drafted answers waiting.`, href: "inbox", cta: "Open inbox" }
          : !project.settings.senderName
            ? { text: "Add your name and signature so emails are signed properly.", href: "settings", cta: "Sender settings" }
            : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-6">
        {project.status === "error" ? (
          <Notice tone="danger">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>Something went wrong: {project.error ?? "unknown error"}</span>
              <form action={rerunAnalysis.bind(null, id)}>
                <SubmitButton size="sm" variant="secondary">Try again</SubmitButton>
              </form>
            </div>
          </Notice>
        ) : null}
        {!ints.anthropic ? <Notice>ANTHROPIC_API_KEY isn&apos;t set, so the agent can&apos;t run. Add it to .env and restart.</Notice> : null}
        {ints.google && mailboxes.length === 0 && p ? (
          <Notice tone="info">
            No mailbox connected yet. <Link href="/settings" className="font-medium underline">Connect Gmail</Link> so approved emails can go out.
          </Notice>
        ) : null}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Leads" value={t?.leads ?? 0} />
          <Stat label="Contacted" value={t?.contacted ?? 0} />
          <Stat label="Replies" value={t?.replies ?? 0} />
          <Stat label="Warm leads" value={t?.positive ?? 0} accent />
          <Stat label="Meetings" value={t?.meetings ?? 0} accent />
          <Stat label="Spend" value={money(t?.cost ?? 0)} sub={t?.positive ? `${money((t.cost ?? 0) / t.positive)}/warm lead` : undefined} />
        </div>

        <Card className="p-5">
          <ol className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
            {steps.map((s, i) => (
              <li key={s.label} className="flex items-center gap-2 text-xs">
                <span
                  className={cn(
                    "num grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold",
                    s.done ? "border-transparent bg-text text-bg" : s.active ? "border-accent text-accent" : "border-border text-faint",
                  )}
                >
                  {s.done ? "✓" : i + 1}
                </span>
                <span className={cn(s.done || s.active ? "text-text" : "text-muted", s.active && "font-medium")}>{s.label}</span>
              </li>
            ))}
          </ol>
          {nextStep ? (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-accent-soft px-4 py-3">
              <span className="text-sm">{nextStep.text}</span>
              <LinkButton href={`/projects/${id}/${nextStep.href}`} variant="primary" size="sm">
                {nextStep.cta} →
              </LinkButton>
            </div>
          ) : null}
        </Card>

        {p ? (
          <Card>
            <CardHeader
              title="What the agent learned"
              description="Used in every email and reply. Edit it in Settings if anything's off."
              action={<LinkButton href={`/projects/${id}/settings`} size="sm" variant="ghost">Edit</LinkButton>}
            />
            <div className="space-y-4 p-5 text-sm">
              <p className="text-[15px] leading-relaxed">{p.oneLiner}</p>
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted">Why customers buy</div>
                  <ul className="space-y-1">
                    {p.valueProps.map((v) => (
                      <li key={v} className="flex gap-2"><span className="text-accent">•</span>{v}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted">Proof points</div>
                  <ul className="space-y-1">
                    {p.proofPoints.length ? (
                      p.proofPoints.map((v) => (
                        <li key={v} className="flex gap-2"><span className="text-accent">•</span>{v}</li>
                      ))
                    ) : (
                      <li className="text-muted">None found. Add some in Settings, as they make emails more credible.</li>
                    )}
                  </ul>
                </div>
              </div>
              <div className="grid gap-5 border-t border-border pt-4 md:grid-cols-3">
                <div><div className="text-xs text-muted">Sells to</div><div className="mt-0.5">{p.idealCustomers}</div></div>
                <div><div className="text-xs text-muted">Geography</div><div className="mt-0.5">{p.geography}</div></div>
                <div><div className="text-xs text-muted">Pricing</div><div className="mt-0.5">{p.pricing ?? "Not listed"}</div></div>
              </div>
            </div>
          </Card>
        ) : null}

        {project.competitors.length ? (
          <Card>
            <CardHeader title="Competitors" description="Excluded from lead lists and used to sharpen positioning." />
            <div className="divide-y divide-border">
              {project.competitors.map((c) => (
                <div key={c.domain} className="flex items-start gap-3 px-5 py-3 text-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`https://www.google.com/s2/favicons?domain=${c.domain}&sz=32`} alt="" className="mt-0.5 size-4 rounded" />
                  <div className="min-w-0">
                    <div className="font-medium">{c.name} <span className="font-normal text-muted">· {c.domain}</span></div>
                    <div className="text-xs text-muted">{c.note}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : null}
      </div>

      <div className="space-y-4">
        <Card className="p-5 lg:sticky lg:top-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Agent activity</h3>
            {project.autopilot ? <Badge tone="accent">Autopilot</Badge> : null}
          </div>
          <ActivityFeed
            projectId={id}
            busy={Boolean(busyJob)}
            initial={feed.map((f) => ({ id: f.id, level: f.level, message: f.message, createdAt: f.createdAt.toISOString() }))}
          />
        </Card>
      </div>
    </div>
  );
}
