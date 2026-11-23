import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/config";
import * as instantly from "@/lib/instantly/client";
import { webhookStatus } from "@/lib/pipeline/instantly";
import { enableWarmupAll } from "@/lib/infra-actions";
import { SubmitButton } from "@/components/client";
import { DomainShop, WebhookConnect } from "@/components/infra";
import { Badge, Card, CardHeader, Notice, PageHeader, Stat } from "@/components/ui";

export const metadata = { title: "Sending infrastructure" };

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
      <div className="max-w-3xl space-y-6">
        <PageHeader title="Sending infrastructure" description="Send thousands of emails a day from warmed mailboxes that land in the inbox." />
        <Card className="space-y-4 p-6 text-sm leading-relaxed">
          <p>
            High-volume cold email works by spreading sends across many <b>separate lookalike domains</b> (never your main one), each with a few
            mailboxes that are <b>warmed up</b> continuously and send ~30 emails a day each. Kindling uses <b>Instantly</b> for that layer:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>Buy pre-warmed domains and mailboxes from this page. DNS (SPF, DKIM, DMARC) is set up for you.</li>
            <li>Warm-up runs non-stop on every mailbox through Instantly&apos;s network.</li>
            <li>Kindling still finds the leads, writes every email and handles every reply. Instantly just delivers.</li>
          </ul>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Create an Instantly account with a plan that includes API access, and add a card.</li>
            <li>Settings → Integrations → API Keys → create a key with scope <code className="font-mono">all:all</code>.</li>
            <li>
              Add it as <code className="font-mono">INSTANTLY_API_KEY</code> in Vercel (or <code className="font-mono">.env</code> locally) and redeploy.
            </li>
          </ol>
        </Card>
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
        title="Sending infrastructure"
        description="Warmed mailboxes on separate domains, rotated automatically. Kindling writes the emails; Instantly delivers them."
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Mailboxes" value={accounts.length} />
        <Stat label="Ready to send" value={ready.length} accent sub={`warm-up score ≥ ${instantly.WARMUP_READY_SCORE}`} />
        <Stat label="Warming up" value={warming.length} />
        <Stat label="Daily capacity" value={capacity.toLocaleString()} sub="cold emails / day" accent />
        <Stat label="Avg warm-up score" value={accounts.length ? avgScore : "—"} sub={problems.length ? `${problems.length} need attention` : "all healthy"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5 text-sm">
          <div className="font-semibold">Replies & bounces</div>
          <p className="mt-1 text-xs text-muted">
            {hook.connected
              ? hook.active
                ? "Connected. Instantly pushes every send, reply, bounce and unsubscribe to Kindling as it happens."
                : "Webhook was disabled by Instantly after failed deliveries. Reconnect it."
              : "Not connected. Kindling still checks Instantly every 5 minutes, but connecting makes replies instant."}
          </p>
          <div className="mt-3"><WebhookConnect connected={hook.connected && hook.active} /></div>
        </Card>
        <Card className="p-5 text-sm">
          <div className="font-semibold">Warm-up</div>
          <p className="mt-1 text-xs text-muted">
            Keep warm-up on for every mailbox, permanently. Kindling only sends from mailboxes scoring {instantly.WARMUP_READY_SCORE}+ and adds new
            ones to campaigns automatically once they get there.
          </p>
          <form action={enableWarmupAll} className="mt-3">
            <SubmitButton size="sm" variant="secondary" pendingText="Turning on…">Turn on warm-up for all mailboxes</SubmitButton>
          </form>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Get more mailboxes"
          description={`Like Explee's "pre-warmed domains from day one". Rule of thumb: ~${PER_MAILBOX_PER_DAY} cold emails per mailbox per day, 3 mailboxes per domain.`}
        />
        <div className="p-5">
          <DomainShop defaultKeyword={keyword} defaultFirst={first ?? ""} defaultLast={rest.join(" ")} />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Mailboxes" description="Live from Instantly." />
        {accounts.length === 0 ? (
          <p className="p-5 text-sm text-muted">No mailboxes yet. Buy pre-warmed ones above, or connect existing ones in Instantly.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-5 py-2.5 font-medium">Mailbox</th>
                  <th className="px-3 py-2.5 font-medium">Provider</th>
                  <th className="px-3 py-2.5 font-medium">Warm-up</th>
                  <th className="px-3 py-2.5 text-right font-medium">Score</th>
                  <th className="px-5 py-2.5 text-right font-medium">Daily limit</th>
                </tr>
              </thead>
              <tbody className="num divide-y divide-border">
                {accounts.map((a) => (
                  <tr key={a.email}>
                    <td className="px-5 py-2.5">
                      <div className="font-mono text-xs">{a.email}</div>
                      <div className="mt-0.5 flex gap-1">{statusBadge(a)}{a.is_managed_account ? <Badge>Done-for-you</Badge> : null}</div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted">{PROVIDER[a.provider_code ?? 0] ?? "—"}</td>
                    <td className="px-3 py-2.5">{warmupBadge(a)}</td>
                    <td className="px-3 py-2.5 text-right">{a.stat_warmup_score ?? "—"}</td>
                    <td className="px-5 py-2.5 text-right">{a.daily_limit ?? "—"}</td>
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
