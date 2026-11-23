import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/config";
import * as instantly from "@/lib/instantly/client";
import { webhookStatus } from "@/lib/pipeline/instantly";
import { enableWarmupAll } from "@/lib/infra-actions";
import { SubmitButton } from "@/components/client";
import { DomainShop, WebhookConnect } from "@/components/infra";
import { Badge, Card, CardHeader, MatrixNumber, Notice, PageHeader, Readouts, Stat } from "@/components/ui";

export const metadata = { title: "Sending" };

const PROVIDER: Record<number, string> = { 1: "SMTP", 2: "Google", 3: "Microsoft", 4: "AWS", 8: "AirMail", 11: "AirMail" };
const PER_MAILBOX_PER_DAY = 30;

function warmupBadge(a: instantly.InstantlyAccount) {
  if (a.setup_pending) return <Badge tone="info">Setting up</Badge>;
  if (a.warmup_status === -1 || a.warmup_status === -3) return <Badge tone="danger">Warm-up blocked</Badge>;
  if (a.warmup_status !== 1) return <Badge tone="warning">Warm-up off</Badge>;
  if (instantly.isReady(a)) return <Badge tone="success">Ready</Badge>;
  return <Badge tone="ai">Warming</Badge>;
}

function statusBadge(a: instantly.InstantlyAccount) {
  if (a.status === 1) return null;
  const label = { 2: "Paused", 3: "Maintenance", [-1]: "Connection error", [-2]: "Soft bounce", [-3]: "Sending error" }[a.status] ?? `Status ${a.status}`;
  return <Badge tone={a.status < 0 ? "danger" : "warning"}>{label}</Badge>;
}

export default async function InfrastructurePage() {
  if (!env.instantlyKey) {
    return (
      <div className="max-w-[760px] space-y-6">
        <PageHeader title="Sending" description="Send thousands of emails a day from warmed mailboxes that land in the inbox." />
        <Card className="space-y-4 p-6 text-[15px] leading-relaxed">
          <p className="max-w-[64ch]">
            High-volume cold email spreads sends across many separate lookalike domains, never your main one. Each domain has a few mailboxes that
            are warmed up continuously and send about 30 emails a day each. Kindling uses Instantly for this part.
          </p>
          <ul className="space-y-2 text-[14px] text-muted">
            {[
              "Buy pre-warmed domains and mailboxes from this page. Their DNS records (SPF, DKIM, DMARC) are set up for you.",
              "Warm-up runs non-stop on every mailbox through Instantly's network.",
              "Kindling still finds the leads, writes every email and handles every reply. Instantly only delivers.",
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <span className="mt-[9px] size-1 shrink-0 rounded-full bg-text" />
                {t}
              </li>
            ))}
          </ul>
        </Card>
        <h2 className="px-1 text-[13px] font-semibold text-muted">Set it up</h2>
        <ol className="overflow-hidden rounded-[22px] bg-surface ring-1 ring-[var(--card-ring)]">
          {[
            <>Create an Instantly account on a plan that includes API access, and add a card.</>,
            <>
              In Instantly, go to Settings, then Integrations, then API Keys, and create a key with the scope{" "}
              <code className="font-mono text-[13px]">all:all</code>.
            </>,
            <>
              Add it as <code className="font-mono text-[13px]">INSTANTLY_API_KEY</code> in Vercel and redeploy.
            </>,
          ].map((step, i) => (
            <li key={i} className="flex gap-5 border-b border-border px-5 py-4 text-[14px] leading-snug last:border-b-0">
              <MatrixNumber value={i + 1} size={16} className="w-5 shrink-0 self-start pt-[3px] text-faint" />
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  let accounts: instantly.InstantlyAccount[] = [];
  let error: string | null = null;
  let hook = { connected: false, active: false };
  try {
    [accounts, hook] = await Promise.all([instantly.listAccounts(), webhookStatus().catch(() => ({ connected: false, active: false }))]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const ready = accounts.filter(instantly.isReady);
  const warming = accounts.filter((a) => !instantly.isReady(a) && a.warmup_status === 1 && a.status === 1);
  const problems = accounts.filter((a) => a.status < 0 || a.warmup_status < 0);
  const capacity = ready.reduce((n, a) => n + Math.min(a.daily_limit ?? PER_MAILBOX_PER_DAY, 50), 0);
  const avgScore = accounts.length
    ? Math.round(accounts.reduce((n, a) => n + (a.stat_warmup_score ?? 0), 0) / accounts.length)
    : 0;

  const project = (await db.select().from(schema.projects).orderBy(desc(schema.projects.createdAt)).limit(1))[0];
  const keyword = project?.domain.split(".")[0] ?? "";
  const [first, ...rest] = (project?.settings.senderName ?? "").split(" ");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sending"
        description="Warmed mailboxes on separate domains, rotated automatically. Kindling writes every email and Instantly delivers it."
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Readouts cols={5}>
        <Stat label="Mailboxes" value={accounts.length} />
        <Stat label="Ready to send" value={ready.length} sub={`Warm-up score ${instantly.WARMUP_READY_SCORE} or more`} />
        <Stat label="Warming up" value={warming.length} />
        <Stat label="Daily capacity" value={capacity.toLocaleString()} sub="Cold emails a day" accent={capacity > 0} />
        <Stat
          label="Average warm-up score"
          value={accounts.length ? avgScore : "–"}
          sub={problems.length ? `${problems.length} need attention` : accounts.length ? "All healthy" : undefined}
        />
      </Readouts>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5 text-[14px]">
          <div className="text-[17px] font-semibold tracking-[-0.02em]">Replies and bounces</div>
          <p className="mt-1 text-[13px] leading-snug text-muted">
            {hook.connected
              ? hook.active
                ? "Connected. Instantly pushes every send, reply, bounce and unsubscribe to Kindling as it happens."
                : "Instantly switched this off after failed deliveries. Reconnect it."
              : "Not connected. Kindling still checks Instantly every 5 minutes, but connecting makes replies instant."}
          </p>
          <div className="mt-4"><WebhookConnect connected={hook.connected && hook.active} /></div>
        </Card>
        <Card className="p-5 text-[14px]">
          <div className="text-[17px] font-semibold tracking-[-0.02em]">Warm-up</div>
          <p className="mt-1 text-[13px] leading-snug text-muted">
            Keep warm-up on for every mailbox, permanently. Kindling only sends from mailboxes scoring {instantly.WARMUP_READY_SCORE} or more, and
            adds new ones to campaigns once they get there.
          </p>
          <form action={enableWarmupAll} className="mt-4">
            <SubmitButton size="sm" variant="secondary" pendingText="Turning on…">Turn on warm-up for all mailboxes</SubmitButton>
          </form>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Get more mailboxes"
          description={`Pre-warmed mailboxes can send from day one. Plan on about ${PER_MAILBOX_PER_DAY} cold emails per mailbox a day, and 3 mailboxes per domain.`}
        />
        <div className="px-5 pb-5">
          <DomainShop defaultKeyword={keyword} defaultFirst={first ?? ""} defaultLast={rest.join(" ")} />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Mailboxes" description="Live from Instantly." />
        {accounts.length === 0 ? (
          <p className="px-5 pb-5 text-[14px] text-muted">No mailboxes yet. Buy pre-warmed ones above, or connect existing ones in Instantly.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-y border-border text-left text-[12px] text-muted">
                  <th className="px-5 py-2.5 font-semibold">Mailbox</th>
                  <th className="px-3 py-2.5 font-semibold">Provider</th>
                  <th className="px-3 py-2.5 font-semibold">Warm-up</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Score</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Daily limit</th>
                </tr>
              </thead>
              <tbody className="num divide-y divide-border">
                {accounts.map((a) => (
                  <tr key={a.email}>
                    <td className="px-5 py-3">
                      <div className="font-medium">{a.email}</div>
                      <div className="mt-1 flex gap-1 empty:hidden">{statusBadge(a)}{a.is_managed_account ? <Badge>Done for you</Badge> : null}</div>
                    </td>
                    <td className="px-3 py-3 text-[13px] text-muted">{PROVIDER[a.provider_code ?? 0] ?? "Other"}</td>
                    <td className="px-3 py-3">{warmupBadge(a)}</td>
                    <td className="px-3 py-3 text-right font-semibold">{a.stat_warmup_score ?? "–"}</td>
                    <td className="px-5 py-3 text-right">{a.daily_limit ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
