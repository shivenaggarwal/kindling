import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env, integrations } from "@/lib/config";
import { redirectUri } from "@/lib/google/client";
import { addSuppression, removeMailbox, removeSuppression, toggleMailbox, updateMailbox } from "@/lib/actions";
import { SubmitButton } from "@/components/client";
import { Badge, buttonClass, Card, CardHeader, Input, Led, Notice, PageHeader } from "@/components/ui";

export const metadata = { title: "Mailboxes & keys" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const sp = await searchParams;
  const ints = integrations();
  const mailboxes = await db.select().from(schema.mailboxes).orderBy(desc(schema.mailboxes.createdAt));
  const suppressions = await db.select().from(schema.suppressions).orderBy(desc(schema.suppressions.createdAt)).limit(200);

  const rows: { name: string; ok: boolean; env: string; what: string; active?: boolean }[] = [
    { name: "Gemini", ok: ints.gemini, active: ints.aiProvider === "gemini", env: "GEMINI_API_KEY", what: "Runs the agent: business research, segments, lead research, emails and replies, using Google Search." },
    { name: "Claude", ok: ints.anthropic, active: ints.aiProvider === "anthropic", env: "ANTHROPIC_API_KEY", what: "The other brain the agent can run on. When both keys are set, AI_PROVIDER picks one." },
    { name: "Instantly (sending)", ok: ints.instantly, env: "INSTANTLY_API_KEY", what: "Pre-warmed domains and mailboxes, continuous warm-up and rotation for high-volume sending. See Sending infrastructure." },
    { name: "Apollo", ok: ints.apollo, env: "APOLLO_API_KEY", what: "Decision makers with verified work emails. Search is free, and each revealed email costs 1 credit." },
    { name: "Hunter", ok: ints.hunter, env: "HUNTER_API_KEY", what: "Finds emails at a company domain and verifies every address before sending." },
    { name: "Google Maps (Places)", ok: ints.places, env: "GOOGLE_PLACES_API_KEY", what: "Local and small businesses: restaurants, clinics, studios, venues." },
    { name: "Google OAuth", ok: ints.google, env: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET", what: "Connect Gmail to send and read replies, and Calendar to book meetings." },
  ];

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Mailboxes & keys" description="The inboxes you send from, and which data sources and AI models are switched on." />

      {sp.connected ? <Notice tone="success">Connected {sp.connected}. It&apos;s ready to send.</Notice> : null}
      {sp.error ? <Notice tone="danger">Google connection failed: {sp.error}</Notice> : null}

      <Card>
        <CardHeader
          title="Gmail mailboxes"
          description="For low-volume sending from your own inbox, and for Google Calendar booking. For high volume, use Sending infrastructure (Instantly)."
          action={
            ints.google ? (
              <a href="/api/google/connect" className={buttonClass("primary", "sm")}>
                Connect Gmail
              </a>
            ) : null
          }
        />
        {!ints.google ? (
          <div className="px-5 pb-5 text-[14px] leading-relaxed text-muted">
            Set <code className="font-mono text-[13px] text-text">GOOGLE_CLIENT_ID</code> and <code className="font-mono text-[13px] text-text">GOOGLE_CLIENT_SECRET</code>{" "}
            (see README), with the redirect URI <code className="font-mono text-[13px] break-all text-text">{redirectUri()}</code>.
          </div>
        ) : mailboxes.length === 0 ? (
          <div className="px-5 pb-5 text-[14px] text-muted">No mailboxes yet. Connect a Gmail or Google Workspace account to start sending.</div>
        ) : (
          <div className="divide-y divide-border border-t border-border">
            {mailboxes.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{m.email}</span>
                    {m.active ? <Badge tone="success">Active</Badge> : <Badge>Paused</Badge>}
                    {m.scopes.includes("calendar.events") ? <Badge tone="info">Calendar</Badge> : null}
                  </div>
                  <div className="mt-0.5 text-[13px] text-muted">
                    {m.lastPolledAt ? `Checked for replies at ${m.lastPolledAt.toLocaleTimeString()}` : "Not checked yet"}
                  </div>
                  {m.lastError ? <div className="mt-1 text-[13px] text-danger">{m.lastError}</div> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={updateMailbox.bind(null, m.id)} className="flex items-center gap-2">
                    <Input name="displayName" defaultValue={m.displayName ?? ""} placeholder="From name" aria-label="From name" className="h-8 w-36 rounded-full text-[13px]" />
                    <Input name="dailyLimit" type="number" min={1} max={500} defaultValue={m.dailyLimit} className="h-8 w-20 rounded-full text-center text-[13px]" aria-label="Daily limit" />
                    <span className="text-[13px] text-muted">a day</span>
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
        <CardHeader title="Keys" description="Set keys as environment variables and redeploy. Kindling uses every source that's configured." />
        <div className="divide-y divide-border border-t border-border">
          {rows.map((r) => (
            <div key={r.name} className="flex items-start justify-between gap-4 px-5 py-4">
              <div className="flex min-w-0 gap-3">
                <Led tone={r.ok ? "success" : "neutral"} className="mt-[7px]" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold tracking-[-0.01em]">{r.name}</span>
                    {r.active ? <Badge tone="accent">Running the agent</Badge> : null}
                  </div>
                  <div className="mt-0.5 max-w-[64ch] text-[13px] leading-snug text-muted">{r.what}</div>
                  <code className="mt-1.5 block font-mono text-[12px] text-faint">{r.env}</code>
                </div>
              </div>
              <span className={r.ok ? "shrink-0 text-[13px] font-medium" : "shrink-0 text-[13px] text-muted"}>{r.ok ? "Connected" : "Not set"}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-border px-5 py-3.5 text-[12px] leading-relaxed text-muted">
          Unit prices used for cost tracking: Apollo ${env.cost.apolloCredit} per credit, Hunter ${env.cost.hunterRequest} per request, Google Maps ${env.cost.placesRequest} per request.
        </div>
      </Card>

      <Card>
        <CardHeader title="Do-not-contact list" description="Unsubscribes and bounces are added automatically. Add emails or whole domains." />
        <form action={addSuppression} className="flex gap-2 px-5 pb-4">
          <Input name="value" placeholder="name@company.com or company.com" aria-label="Email or domain" />
          <SubmitButton variant="primary">Add</SubmitButton>
        </form>
        <div className="max-h-80 divide-y divide-border overflow-y-auto border-t border-border">
          {suppressions.length === 0 ? <p className="px-5 py-4 text-[14px] text-muted">No one yet.</p> : null}
          {suppressions.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-5 py-2.5 text-[14px]">
              <span>{s.value}</span>
              <div className="flex items-center gap-3">
                <Badge>{s.reason}</Badge>
                <form action={removeSuppression.bind(null, s.id)}>
                  <button className="text-[13px] font-medium text-muted transition-colors hover:text-danger">Remove</button>
                </form>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
