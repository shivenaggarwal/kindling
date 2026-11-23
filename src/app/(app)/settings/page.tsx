import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env, integrations } from "@/lib/config";
import { redirectUri } from "@/lib/google/client";
import { addSuppression, removeMailbox, removeSuppression, toggleMailbox, updateMailbox } from "@/lib/actions";
import { SubmitButton } from "@/components/client";
import { Badge, buttonClass, Card, CardHeader, Input, Notice, PageHeader } from "@/components/ui";

export const metadata = { title: "Mailboxes & integrations" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const sp = await searchParams;
  const ints = integrations();
  const mailboxes = await db.select().from(schema.mailboxes).orderBy(desc(schema.mailboxes.createdAt));
  const suppressions = await db.select().from(schema.suppressions).orderBy(desc(schema.suppressions.createdAt)).limit(200);

  const rows: { name: string; ok: boolean; env: string; what: string }[] = [
    { name: "Claude (Anthropic)", ok: ints.anthropic, env: "ANTHROPIC_API_KEY", what: "Required. Business analysis, segments, lead research, emails and replies." },
    { name: "Apollo", ok: ints.apollo, env: "APOLLO_API_KEY", what: "Decision makers with verified work emails. Search is free, and each revealed email costs 1 credit." },
    { name: "Hunter", ok: ints.hunter, env: "HUNTER_API_KEY", what: "Finds emails at a company domain and verifies every address before sending." },
    { name: "Google Maps (Places)", ok: ints.places, env: "GOOGLE_PLACES_API_KEY", what: "Local and small businesses: restaurants, clinics, studios, venues." },
    { name: "Google OAuth", ok: ints.google, env: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET", what: "Connect Gmail to send and read replies, and Calendar to book meetings." },
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Mailboxes & integrations" description="Connect the inboxes you send from, and see which data sources are switched on." />

      {sp.connected ? <Notice tone="success">Connected {sp.connected}. It&apos;s ready to send.</Notice> : null}
      {sp.error ? <Notice tone="danger">Google connection failed: {sp.error}</Notice> : null}

      <Card>
        <CardHeader
          title="Sending mailboxes"
          description="Each mailbox sends up to its daily limit. Start low (20–30/day) on new or rarely-used accounts and raise it slowly."
          action={
            ints.google ? (
              <a href="/api/google/connect" className={buttonClass("primary", "sm")}>
                Connect Gmail
              </a>
            ) : null
          }
        />
        {!ints.google ? (
          <div className="p-5 text-sm text-muted">
            Set <code className="font-mono text-text">GOOGLE_CLIENT_ID</code> and <code className="font-mono text-text">GOOGLE_CLIENT_SECRET</code> in{" "}
            <code className="font-mono">.env</code> (see README), with redirect URI <code className="font-mono text-text">{redirectUri()}</code>.
          </div>
        ) : mailboxes.length === 0 ? (
          <div className="p-5 text-sm text-muted">No mailboxes yet. Connect a Gmail or Google Workspace account to start sending.</div>
        ) : (
          <div className="divide-y divide-border">
            {mailboxes.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{m.email}</span>
                    {m.active ? <Badge tone="success">Active</Badge> : <Badge>Paused</Badge>}
                    {m.scopes.includes("calendar.events") ? <Badge tone="info">Calendar</Badge> : null}
                  </div>
                  <div className="text-xs text-muted">
                    {m.lastPolledAt ? `Checked for replies ${m.lastPolledAt.toLocaleTimeString()}` : "Not checked yet"}
                  </div>
                  {m.lastError ? <div className="mt-1 text-xs text-danger">{m.lastError}</div> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={updateMailbox.bind(null, m.id)} className="flex items-center gap-2">
                    <Input name="displayName" defaultValue={m.displayName ?? ""} placeholder="From name" className="h-8 w-36 text-xs" />
                    <Input name="dailyLimit" type="number" min={1} max={500} defaultValue={m.dailyLimit} className="h-8 w-20 text-xs" aria-label="Daily limit" />
                    <span className="text-xs text-muted">/day</span>
                    <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
                  </form>
                  <form action={toggleMailbox.bind(null, m.id)}>
                    <SubmitButton size="sm" variant="ghost">{m.active ? "Pause" : "Resume"}</SubmitButton>
                  </form>
                  <form action={removeMailbox.bind(null, m.id)}>
                    <SubmitButton size="sm" variant="ghost" confirm={`Disconnect ${m.email}? Replies on its threads won't be tracked any more.`}>
                      Remove
                    </SubmitButton>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Integrations" description="Set keys in .env and restart. Kindling uses every source that's configured." />
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <div key={r.name} className="flex items-start justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0">
                <div className="text-sm font-medium">{r.name}</div>
                <div className="text-xs text-muted">{r.what}</div>
                <code className="mt-1 block font-mono text-[11px] text-faint">{r.env}</code>
              </div>
              {r.ok ? <Badge tone="success">Connected</Badge> : <Badge tone="warning">Not set</Badge>}
            </div>
          ))}
        </div>
        <div className="border-t border-border px-5 py-3 text-xs text-muted">
          Cost tracking: Apollo ${env.cost.apolloCredit}/credit · Hunter ${env.cost.hunterRequest}/request · Maps ${env.cost.placesRequest}/request
        </div>
      </Card>

      <Card>
        <CardHeader title="Do-not-contact list" description="Unsubscribes and bounces are added automatically. Add emails or whole domains." />
        <form action={addSuppression} className="flex gap-2 border-b border-border p-5">
          <Input name="value" placeholder="name@company.com or company.com" />
          <SubmitButton variant="secondary">Add</SubmitButton>
        </form>
        <div className="max-h-80 divide-y divide-border overflow-y-auto">
          {suppressions.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Empty.</p> : null}
          {suppressions.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-5 py-2 text-sm">
              <span className="font-mono text-xs">{s.value}</span>
              <div className="flex items-center gap-3">
                <Badge>{s.reason}</Badge>
                <form action={removeSuppression.bind(null, s.id)}>
                  <button className="text-xs text-muted hover:text-danger">Remove</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
