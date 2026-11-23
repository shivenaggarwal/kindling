import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env, sendVia } from "@/lib/config";
import * as instantly from "@/lib/instantly/client";
import { deleteProject, rerunAnalysis, updateProfile, updateProjectSettings } from "@/lib/actions";
import { SubmitButton } from "@/components/client";
import { Card, CardHeader, Field, Input, Textarea } from "@/components/ui";

export const metadata = { title: "Project settings" };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = (await db.query.projects.findFirst({ where: eq(schema.projects.id, id) }))!;
  const mailboxes = await db.select().from(schema.mailboxes);
  const s = project.settings;
  const p = project.profile;
  const via = sendVia(s);
  const instantlyAccounts = env.instantlyKey ? await instantly.listAccounts().catch(() => []) : [];

  return (
    <div className="max-w-[760px] space-y-6">
      <form action={updateProjectSettings.bind(null, id)} className="space-y-6">
        <Card>
          <CardHeader title="Sender" description="How emails are signed. A real name and postal address are required for compliant cold email." />
          <div className="grid gap-4 px-5 pt-2 pb-5 md:grid-cols-2">
            <Field label="Your name"><Input name="senderName" defaultValue={s.senderName} placeholder="Alex Morgan" /></Field>
            <Field label="Title"><Input name="senderTitle" defaultValue={s.senderTitle} placeholder="Founder" /></Field>
            <Field label="Signature lines" hint="Company, phone, website. No images." className="md:col-span-2">
              <Textarea name="signature" rows={2} defaultValue={s.signature} placeholder={`${p?.companyName ?? "Company"} · ${project.domain}`} />
            </Field>
            <Field label="Postal address" hint="Shown in the footer (CAN-SPAM / PECR)." className="md:col-span-2">
              <Input name="physicalAddress" defaultValue={s.physicalAddress} placeholder="1 Example Street, London, EC1A 1AA" />
            </Field>
            <Field label="Opt-out line" className="md:col-span-2">
              <Input name="optOutLine" defaultValue={s.optOutLine} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Delivery" description="How emails reach the inbox." />
          <div className="space-y-3 px-5 pt-2 pb-5">
            {(
              [
                ["instantly", "Instantly: warmed mailboxes on separate domains", "High volume (hundreds to thousands a day), continuous warm-up, rotation. Recommended."],
                ["gmail", "Gmail: your connected inbox", "Low volume (~30/day per inbox). Good for testing or warm intros."],
              ] as const
            ).map(([v, label, hint]) => (
              <label key={v} className="flex cursor-pointer items-start gap-3 rounded-[16px] bg-surface-2 p-4 ring-1 ring-transparent transition-colors has-checked:bg-surface has-checked:ring-text">
                <input type="radio" name="sendVia" value={v} defaultChecked={via === v} className="mt-1" />
                <span>
                  <span className="block text-[15px] font-semibold tracking-[-0.01em]">{label}</span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-muted">{hint}{v === "instantly" && !env.instantlyKey ? " INSTANTLY_API_KEY isn't set yet." : ""}</span>
                </span>
              </label>
            ))}
            {instantlyAccounts.length ? (
              <div>
                <span className="mb-1.5 block text-[13px] font-medium">Instantly mailboxes for this project</span>
                <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
                  {instantlyAccounts.map((a) => (
                    <label key={a.email} className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[13px] ring-1 ring-transparent transition-colors has-checked:bg-surface has-checked:ring-text">
                      <input type="checkbox" name="instantlyAccounts" value={a.email} defaultChecked={(s.instantlyAccounts ?? []).includes(a.email)} />
                      {a.email}
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-[12px] text-muted">Leave all unticked to use every warmed mailbox. Ticking some is useful when several businesses share one Instantly workspace.</p>
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="Sending window" description="For Gmail, Kindling spaces sends inside this window. For Instantly, it becomes each campaign's schedule." />
          <div className="grid gap-4 px-5 pt-2 pb-5 md:grid-cols-3">
            <Field label="Timezone" hint="IANA name, e.g. America/New_York"><Input name="timezone" defaultValue={s.timezone} /></Field>
            <Field label="Window starts (hour)"><Input name="sendWindowStart" type="number" min={0} max={23} defaultValue={s.sendWindowStart} /></Field>
            <Field label="Window ends (hour)"><Input name="sendWindowEnd" type="number" min={1} max={24} defaultValue={s.sendWindowEnd} /></Field>
            <div className="md:col-span-3">
              <span className="mb-1.5 block text-[13px] font-medium">Days</span>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((d, i) => (
                  <label key={d} className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-1.5 text-[13px] font-medium ring-1 ring-transparent transition-colors has-checked:bg-surface has-checked:ring-text">
                    <input type="checkbox" name="sendDays" value={i} defaultChecked={s.sendDays.includes(i)} />
                    {d}
                  </label>
                ))}
              </div>
            </div>
            <Field label="Follow-up gaps (days)" hint="Days before follow-up 1, then follow-up 2"><Input name="followupDays" defaultValue={s.followupDays.join(", ")} /></Field>
            <Field label="Leads per batch"><Input name="leadsPerBatch" type="number" min={5} max={100} defaultValue={s.leadsPerBatch} /></Field>
            <div className="md:col-span-3">
              <span className="mb-1.5 block text-[13px] font-medium">Gmail mailboxes to send from</span>
              {mailboxes.length === 0 ? (
                <p className="text-[14px] text-muted">No mailboxes connected yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {mailboxes.map((m) => (
                    <label key={m.id} className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-1.5 text-[13px] font-medium ring-1 ring-transparent transition-colors has-checked:bg-surface has-checked:ring-text">
                      <input type="checkbox" name="mailboxIds" value={m.id} defaultChecked={s.mailboxIds.includes(m.id)} />
                      {m.email}
                    </label>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[12px] text-muted">Leave all unticked to rotate across every active mailbox.</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Meetings & replies" />
          <div className="grid gap-4 px-5 pt-2 pb-5 md:grid-cols-3">
            <Field label="Booking link (optional)" hint="Used when direct calendar booking isn't available" className="md:col-span-2">
              <Input name="bookingUrl" defaultValue={s.bookingUrl} placeholder="https://cal.com/you/intro" />
            </Field>
            <Field label="Meeting length (min)"><Input name="meetingMinutes" type="number" min={10} max={120} defaultValue={s.meetingMinutes} /></Field>
            <Field label="Instructions for the agent" hint="Tone, offers, who to avoid, what not to say. Applied to every email and reply." className="md:col-span-3">
              <Textarea name="extraInstructions" rows={4} defaultValue={s.extraInstructions} placeholder="e.g. Offer a free sample box. Never mention pricing in the first email. Avoid companies in Florida." />
            </Field>
          </div>
        </Card>

        <SubmitButton pendingText="Saving…">Save settings</SubmitButton>
      </form>

      {p ? (
        <form action={updateProfile.bind(null, id)}>
          <Card>
            <CardHeader title="Business profile" description="What the agent knows about the business. Correct anything wrong. It feeds every email." />
            <div className="grid gap-4 px-5 pt-2 pb-5">
              <Field label="One-liner"><Input name="oneLiner" defaultValue={p.oneLiner} /></Field>
              <Field label="Offering"><Textarea name="offering" rows={3} defaultValue={p.offering} /></Field>
              <Field label="Value props" hint="One per line"><Textarea name="valueProps" rows={4} defaultValue={p.valueProps.join("\n")} /></Field>
              <Field label="Proof points" hint="Clients, numbers, years in business. One per line"><Textarea name="proofPoints" rows={3} defaultValue={p.proofPoints.join("\n")} /></Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Pricing"><Input name="pricing" defaultValue={p.pricing ?? ""} /></Field>
                <Field label="Geography"><Input name="geography" defaultValue={p.geography} /></Field>
              </div>
              <div><SubmitButton pendingText="Saving…" variant="secondary">Save profile</SubmitButton></div>
            </div>
          </Card>
        </form>
      ) : null}

      <Card>
        <CardHeader title="Danger zone" />
        <div className="flex flex-wrap gap-3 px-5 pt-2 pb-5">
          <form action={rerunAnalysis.bind(null, id)}>
            <SubmitButton variant="secondary" confirm="Re-read the website and propose fresh segments? Unused proposed segments are replaced.">
              Re-run analysis
            </SubmitButton>
          </form>
          <form action={deleteProject.bind(null, id)}>
            <SubmitButton variant="danger" confirm={`Delete ${project.name} and all its leads, emails and history? This can't be undone.`}>
              Delete project
            </SubmitButton>
          </form>
        </div>
      </Card>
    </div>
  );
}
