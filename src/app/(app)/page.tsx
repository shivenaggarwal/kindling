import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { APP_NAME, integrations } from "@/lib/config";
import { projectTotals } from "@/lib/pipeline/stats";
import { NewProjectForm } from "@/components/new-project-form";
import { Logo } from "@/components/logo";
import { Badge, Led, LinkButton, MatrixNumber, money, Notice, PageHeader, Readouts, Stat } from "@/components/ui";

const STEPS = [
  ["Learns what you sell", "Reads your site, pricing and proof points, and maps your competitors."],
  ["Works out who buys it", "Proposes customer segments with a fit score and the exact job titles to reach."],
  ["Finds those people", "Searches Apollo, Hunter, Google Maps and the open web for decision makers."],
  ["Writes to each one", "Researches every company and writes a three-step sequence that reads like you wrote it."],
  ["Answers the replies", "Reads every reply, answers questions and puts calls on your calendar."],
  ["Backs what works", "Tracks cost per warm lead by segment, scales the winners and pauses the rest."],
];

export default async function Home() {
  const projects = await db.select().from(schema.projects).orderBy(desc(schema.projects.createdAt));
  const ints = integrations();
  const mailboxes = await db.select({ id: schema.mailboxes.id }).from(schema.mailboxes);

  const setupIssues = [
    !ints.ai && "Add GEMINI_API_KEY (or ANTHROPIC_API_KEY). The agent can't think without one.",
    !ints.instantly && !ints.google && "Connect a way to send: an Instantly key for high volume, or Google sign-in for Gmail.",
    !ints.instantly && ints.google && mailboxes.length === 0 && "Connect a Gmail mailbox in Mailboxes & keys so emails can go out.",
  ].filter(Boolean) as string[];

  if (projects.length === 0) {
    return (
      <div className="mx-auto max-w-[680px] pt-2 md:pt-12">
        <div className="flex flex-col items-center text-center">
          <Logo size={44} />
          <h1 className="mt-8 text-[40px] font-bold leading-[1.04] tracking-[-0.045em] md:text-[60px]">
            Your website in.
            <br />
            Booked meetings out.
          </h1>
          <p className="mt-5 max-w-[46ch] text-[17px] leading-snug text-muted">
            {APP_NAME} studies your market, finds the people most likely to buy, writes to each of them personally, and
            handles the replies.
          </p>
        </div>
        <div className="mt-10">
          <NewProjectForm large />
        </div>
        {setupIssues.length ? (
          <div className="mt-6 space-y-2">
            {setupIssues.map((s) => (
              <Notice key={s}>{s}</Notice>
            ))}
          </div>
        ) : null}

        <h2 className="mt-20 mb-4 px-1 text-[13px] font-semibold text-muted">What happens next</h2>
        <ol className="overflow-hidden rounded-[22px] bg-surface ring-1 ring-[var(--card-ring)]">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="flex gap-5 border-b border-border px-5 py-4 last:border-b-0">
              <MatrixNumber value={i + 1} size={16} className="w-6 shrink-0 self-start pt-[5px] text-faint" />
              <div>
                <div className="text-[15px] font-semibold tracking-[-0.01em]">{title}</div>
                <p className="mt-0.5 text-[14px] leading-snug text-muted">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const totals = await Promise.all(projects.map((p) => projectTotals(p.id)));
  const sum = (k: keyof (typeof totals)[number]) => totals.reduce((a, t) => a + Number(t?.[k] ?? 0), 0);
  const warm = sum("positive");

  return (
    <div>
      <PageHeader
        title="Overview"
        description="What your agent has done across every project."
        action={
          <LinkButton href="/projects/new" variant="primary">
            New project
          </LinkButton>
        }
      />
      {setupIssues.length ? (
        <div className="mb-6 space-y-2">
          {setupIssues.map((s) => (
            <Notice key={s}>{s}</Notice>
          ))}
        </div>
      ) : null}

      <Readouts cols={3}>
        <Stat label="Leads found" value={sum("leads")} />
        <Stat label="Emails sent" value={sum("sent")} />
        <Stat label="Replies" value={sum("replies")} />
        <Stat label="Warm leads" value={warm} accent={warm > 0} />
        <Stat label="Meetings booked" value={sum("meetings")} accent={sum("meetings") > 0} />
        <Stat label="Spend" value={money(sum("cost"))} sub={warm ? `${money(sum("cost") / warm)} per warm lead` : "Data, AI and sending costs"} />
      </Readouts>

      <h2 className="mt-12 mb-3 px-1 text-[13px] font-semibold text-muted">Projects</h2>
      <div className="overflow-hidden rounded-[22px] bg-surface ring-1 ring-[var(--card-ring)]">
        {projects.map((p, i) => {
          const t = totals[i];
          const needs = (t?.drafts ?? 0) + (t?.pending_replies ?? 0);
          return (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="group flex items-center gap-4 border-b border-border px-5 py-4 transition-colors last:border-b-0 hover:bg-surface-2/60"
            >
              <Led tone={p.status === "analyzing" ? "ai" : p.status === "error" ? "danger" : needs ? "accent" : "success"} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">{p.name}</span>
                  <span className="truncate text-[13px] text-muted">{p.domain}</span>
                  {p.autopilot ? <Badge tone="accent">Autopilot</Badge> : null}
                  {p.status === "error" ? <Badge tone="danger">Needs attention</Badge> : null}
                </div>
                {p.profile ? <p className="mt-1 line-clamp-1 text-[13px] text-muted">{p.profile.oneLiner}</p> : null}
              </div>
              <dl className="num hidden shrink-0 grid-cols-4 gap-6 text-right lg:grid">
                {(
                  [
                    ["Leads", t?.leads],
                    ["Contacted", t?.contacted],
                    ["Warm", t?.positive],
                    ["Meetings", t?.meetings],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dd className="flex justify-end"><MatrixNumber value={v ?? 0} size={15} /></dd>
                    <dt className="mt-1 text-[11px] text-muted">{k}</dt>
                  </div>
                ))}
              </dl>
              {needs ? (
                <span className="num shrink-0 rounded-full bg-signal px-2 text-[12px] font-bold leading-[20px] text-signal-ink" title={`${needs} waiting for your review`}>
                  {needs}
                </span>
              ) : null}
              <span aria-hidden className="text-[18px] text-faint transition-transform group-hover:translate-x-0.5">
                ›
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
