import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { APP_NAME, integrations } from "@/lib/config";
import { projectTotals } from "@/lib/pipeline/stats";
import { NewProjectForm } from "@/components/new-project-form";
import { Badge, Card, LinkButton, money, Notice, PageHeader, Stat } from "@/components/ui";

const STEPS = [
  ["Learns what you sell", "Reads your site, pricing and proof points, and maps your competitors."],
  ["Figures out who buys it", "Proposes customer segments with a fit score and the exact titles to reach."],
  ["Finds those exact people", "Searches Apollo, Hunter, Google Maps and the open web for decision makers."],
  ["Writes each a personal email", "Researches every company and writes a 3-step sequence that sounds human."],
  ["Handles replies, books meetings", "Reads replies, answers questions and puts calls straight on your calendar."],
  ["Doubles down on what works", "Tracks cost per warm lead by segment, scales winners and pauses losers."],
];

export default async function Home() {
  const projects = await db.select().from(schema.projects).orderBy(desc(schema.projects.createdAt));
  const ints = integrations();
  const mailboxes = await db.select({ id: schema.mailboxes.id }).from(schema.mailboxes);

  const setupIssues = [
    !ints.anthropic && "Add ANTHROPIC_API_KEY to .env. The agent can't think without it.",
    !ints.google && "Add GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET to connect Gmail for sending.",
    ints.google && mailboxes.length === 0 && "Connect a Gmail mailbox in Mailboxes & integrations so emails can go out.",
  ].filter(Boolean) as string[];

  if (projects.length === 0) {
    return (
      <div className="mx-auto max-w-3xl pt-6 md:pt-14">
        <div className="text-center">
          <Badge tone="accent">Your 24/7 outbound agent</Badge>
          <h1 className="mt-5 font-display text-5xl leading-[1.05] tracking-tight md:text-6xl">
            Turn your website into <span className="italic text-accent">booked meetings</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] text-muted">
            {APP_NAME} researches your market, finds the people most likely to buy, writes to each of them personally,
            and handles the replies.
          </p>
        </div>
        <div className="mt-8">
          <NewProjectForm large />
        </div>
        {setupIssues.length ? (
          <div className="mt-6 space-y-2">
            {setupIssues.map((s) => (
              <Notice key={s}>{s}</Notice>
            ))}
          </div>
        ) : null}
        <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map(([title, body], i) => (
            <Card key={title} className="p-4">
              <div className="num font-mono text-xs text-accent">0{i + 1}</div>
              <div className="mt-1.5 text-sm font-semibold">{title}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted">{body}</p>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const totals = await Promise.all(projects.map((p) => projectTotals(p.id)));
  const sum = (k: keyof (typeof totals)[number]) => totals.reduce((a, t) => a + Number(t?.[k] ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Everything your agent is doing across projects."
        action={<LinkButton href="/projects/new" variant="primary">New project</LinkButton>}
      />
      {setupIssues.length ? (
        <div className="mb-6 space-y-2">
          {setupIssues.map((s) => (
            <Notice key={s}>{s}</Notice>
          ))}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Leads found" value={sum("leads")} />
        <Stat label="Emails sent" value={sum("sent")} />
        <Stat label="Replies" value={sum("replies")} />
        <Stat label="Warm leads" value={sum("positive")} accent />
        <Stat label="Meetings" value={sum("meetings")} accent />
        <Stat label="Spend" value={money(sum("cost"))} sub={sum("positive") ? `${money(sum("cost") / sum("positive"))} per warm lead` : undefined} />
      </div>

      <h2 className="mt-10 mb-3 text-sm font-semibold">Projects</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {projects.map((p, i) => {
          const t = totals[i];
          const needs = (t?.drafts ?? 0) + (t?.pending_replies ?? 0);
          return (
            <Link key={p.id} href={`/projects/${p.id}`} className="group">
              <Card className="p-5 transition-colors group-hover:border-border-strong">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{p.name}</div>
                    <div className="truncate text-xs text-muted">{p.domain}</div>
                  </div>
                  <div className="flex gap-1.5">
                    {p.autopilot ? <Badge tone="accent">Autopilot</Badge> : null}
                    {p.status === "analyzing" ? <Badge tone="ai">Analyzing…</Badge> : null}
                    {p.status === "error" ? <Badge tone="danger">Error</Badge> : null}
                  </div>
                </div>
                {p.profile ? <p className="mt-3 line-clamp-2 text-sm text-muted">{p.profile.oneLiner}</p> : null}
                <div className="num mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                  <span><b className="text-text">{t?.leads ?? 0}</b> leads</span>
                  <span><b className="text-text">{t?.contacted ?? 0}</b> contacted</span>
                  <span><b className="text-text">{t?.positive ?? 0}</b> warm</span>
                  <span><b className="text-text">{t?.meetings ?? 0}</b> meetings</span>
                  {needs ? <span className="font-medium text-accent">{needs} need review</span> : null}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
