import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { APP_NAME, env, sendVia } from "../config";
import type { Lead, Message, Project, Segment } from "../db/schema";
import * as instantly from "../instantly/client";
import { activity } from "../log";
import { enqueue } from "../jobs/queue";
import { htmlToText } from "../sources/site";
import { tzOffsetMinutes } from "../time";
import { renderBody } from "./write";

/**
 * Explee-style delivery: Kindling writes every email, Instantly sends them
 * from warmed, rotating mailboxes. One Instantly campaign per segment; each
 * lead carries its own AI-written copy as custom variables.
 */

const V = { subject: "kSubject", email1: "kEmail1", followup1: "kFollowup1", followup2: "kFollowup2" } as const;

// Instantly accepts a fixed list of timezones. Fall back to a supported zone
// with the same UTC offset (or shift the sending window to America/Chicago).
const KNOWN_ZONES = [
  "America/Chicago",
  "Europe/Isle_of_Man",
  "Atlantic/Canary",
  "Africa/Abidjan",
  "Europe/Belgrade",
  "Europe/Sarajevo",
  "Europe/Bucharest",
  "Europe/Helsinki",
  "Europe/Istanbul",
  "Europe/Kaliningrad",
  "Asia/Dubai",
  "America/Detroit",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Australia/Sydney",
];

/** Instantly's `days` keys: assumed Monday-first ("0" = Monday … "6" = Sunday). Set INSTANTLY_SUNDAY_FIRST=1 to flip. */
function instantlyDays(sendDays: number[]) {
  const sundayFirst = process.env.INSTANTLY_SUNDAY_FIRST === "1";
  const days: Record<string, boolean> = {};
  for (let i = 0; i < 7; i++) {
    const jsDay = sundayFirst ? i : (i + 1) % 7; // JS: 0 = Sunday
    days[String(i)] = sendDays.includes(jsDay);
  }
  return days;
}

const hh = (h: number) => `${String(Math.max(0, Math.min(23, h))).padStart(2, "0")}:00`;

function scheduleCandidates(project: Project) {
  const s = project.settings;
  const now = new Date();
  const want = tzOffsetMinutes(now, s.timezone);
  const exact = { tz: s.timezone, from: s.sendWindowStart, to: s.sendWindowEnd };
  const sameOffset = KNOWN_ZONES.filter((z) => z !== s.timezone && tzOffsetMinutes(now, z) === want).map((tz) => ({
    tz,
    from: s.sendWindowStart,
    to: s.sendWindowEnd,
  }));
  const shift = Math.round((tzOffsetMinutes(now, "America/Chicago") - want) / 60);
  const chicago = { tz: "America/Chicago", from: s.sendWindowStart + shift, to: s.sendWindowEnd + shift };
  return [exact, ...sameOffset, chicago].map((c) => ({ ...c, from: Math.max(0, c.from), to: Math.min(24, Math.max(c.from + 1, c.to)) }));
}

export async function readyAccounts(project?: Project) {
  const all = await instantly.listAccounts();
  let ready = all.filter(instantly.isReady);
  const allowed = project?.settings.instantlyAccounts ?? [];
  if (allowed.length) ready = ready.filter((a) => allowed.includes(a.email));
  return { all, ready };
}

async function ensureCampaign(project: Project, segment: Segment, senders: string[]): Promise<string> {
  if (segment.instantlyCampaignId) {
    // Keep the sender list current as new mailboxes finish warming up.
    try {
      const c = await instantly.getCampaign(segment.instantlyCampaignId);
      const current = new Set(c.email_list ?? []);
      if (senders.length && (senders.length !== current.size || senders.some((e) => !current.has(e)))) {
        await instantly.patchCampaign(segment.instantlyCampaignId, { email_list: senders });
      }
    } catch (e) {
      console.warn("[instantly] campaign refresh failed", e);
    }
    return segment.instantlyCampaignId;
  }

  const s = project.settings;
  const gaps = s.followupDays.length >= 2 ? s.followupDays : [3, 4];
  const base: Omit<instantly.CampaignInput, "campaign_schedule"> = {
    name: `${project.name} · ${segment.name}`.slice(0, 120),
    sequences: [
      {
        steps: [
          // `delay` = days to wait after this step before the next one.
          { type: "email", delay: gaps[0], delay_unit: "days", variants: [{ subject: `{{${V.subject}}}`, body: `{{${V.email1}}}` }] },
          // Empty subject → sent as a reply in the same thread.
          { type: "email", delay: gaps[1], delay_unit: "days", variants: [{ subject: "", body: `{{${V.followup1}}}` }] },
          { type: "email", delay: 1, delay_unit: "days", variants: [{ subject: "", body: `{{${V.followup2}}}` }] },
        ],
      },
    ],
    email_list: senders,
    daily_limit: null,
    stop_on_reply: true,
    stop_on_auto_reply: false,
    text_only: true,
    link_tracking: false,
    open_tracking: false,
    insert_unsubscribe_header: true,
    email_gap: 9,
    random_wait_max: 8,
  };

  let created: instantly.InstantlyCampaign | null = null;
  let lastErr: unknown = null;
  for (const c of scheduleCandidates(project)) {
    try {
      created = await instantly.createCampaign({
        ...base,
        campaign_schedule: {
          schedules: [{ name: "Business hours", timing: { from: hh(c.from), to: c.to >= 24 ? "23:59" : hh(c.to) }, days: instantlyDays(s.sendDays), timezone: c.tz }],
        },
      });
      if (c.tz !== s.timezone) {
        await activity(project.id, `Instantly doesn't support ${s.timezone}; scheduled ${segment.name} in ${c.tz} ${hh(c.from)}–${hh(c.to)} instead`, "warning");
      }
      break;
    } catch (e) {
      lastErr = e;
      const timezoneProblem = e instanceof instantly.InstantlyError && e.status === 400 && /time ?zone/i.test(e.message);
      if (!timezoneProblem) throw e;
    }
  }
  if (!created) throw lastErr ?? new Error("Couldn't create the Instantly campaign");

  await instantly.addCampaignVariables(created.id, Object.values(V)).catch((e) => console.warn("[instantly] add variables", e));
  await db.update(schema.segments).set({ instantlyCampaignId: created.id }).where(eq(schema.segments.id, segment.id));
  await activity(project.id, `Created Instantly campaign for ${segment.name} with ${senders.length} warmed mailbox${senders.length === 1 ? "" : "es"}`, "success");
  return created.id;
}

/**
 * Hand approved sequences to Instantly. Each lead's three emails travel as
 * custom variables; Instantly sends them from warmed mailboxes on schedule.
 */
export async function pushApprovedToInstantly() {
  if (!env.instantlyKey) return;
  const pending = await db
    .select({ m: schema.messages, lead: schema.leads, seg: schema.segments, project: schema.projects })
    .from(schema.messages)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.messages.leadId))
    .innerJoin(schema.segments, eq(schema.segments.id, schema.messages.segmentId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.messages.projectId))
    .where(
      and(
        eq(schema.messages.kind, "sequence"),
        eq(schema.messages.step, 0),
        eq(schema.messages.status, "approved"),
        isNull(schema.leads.instantlyLeadId),
        eq(schema.segments.status, "active"),
        inArray(schema.leads.status, ["drafted"]),
      ),
    )
    .limit(500);

  const forInstantly = pending.filter((r) => sendVia(r.project.settings) === "instantly");
  if (!forInstantly.length) return;

  const suppressed = new Set((await db.select({ v: schema.suppressions.value }).from(schema.suppressions)).map((r) => r.v));
  let accountsCache: Awaited<ReturnType<typeof readyAccounts>> | null = null;

  // Group by segment → one campaign each.
  const bySegment = new Map<string, typeof forInstantly>();
  for (const r of forInstantly) {
    if (suppressed.has(r.lead.email) || suppressed.has(r.lead.email.split("@")[1] ?? "")) continue;
    bySegment.set(r.seg.id, [...(bySegment.get(r.seg.id) ?? []), r]);
  }

  for (const rows of bySegment.values()) {
    const { project, seg } = rows[0];
    try {
      accountsCache ??= await readyAccounts();
      const allowed = project.settings.instantlyAccounts ?? [];
      const senders = accountsCache.ready.filter((a) => !allowed.length || allowed.includes(a.email)).map((a) => a.email);
      if (!senders.length) {
        await activity(
          project.id,
          `${rows.length} approved emails are waiting: no Instantly mailbox is warmed up yet (score ≥ ${instantly.WARMUP_READY_SCORE}). See Sending infrastructure.`,
          "warning",
        );
        continue;
      }
      const campaignId = await ensureCampaign(project, seg, senders);

      // Load every step for these leads.
      const leadIds = rows.map((r) => r.lead.id);
      const steps = await db
        .select()
        .from(schema.messages)
        .where(and(inArray(schema.messages.leadId, leadIds), eq(schema.messages.kind, "sequence"), inArray(schema.messages.status, ["approved", "draft"])));
      const byLead = new Map<string, Message[]>();
      for (const m of steps) byLead.set(m.leadId, [...(byLead.get(m.leadId) ?? []), m]);

      const companyIds = rows.map((r) => r.lead.companyId).filter((x): x is string => !!x);
      const companies = companyIds.length
        ? await db.select().from(schema.companies).where(inArray(schema.companies.id, companyIds))
        : [];
      const companyById = new Map(companies.map((c) => [c.id, c]));

      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const payload: instantly.LeadInput[] = batch.map(({ lead }) => {
          const msgs = (byLead.get(lead.id) ?? []).sort((a, b) => a.step - b.step);
          const body = (step: number) => {
            const m = msgs.find((x) => x.step === step);
            return m ? instantly.textToHtml(renderBody(m.body, project.settings)) : "";
          };
          const company = lead.companyId ? companyById.get(lead.companyId) : undefined;
          return {
            email: lead.email,
            first_name: lead.firstName ?? undefined,
            last_name: lead.lastName ?? undefined,
            company_name: company?.name,
            job_title: lead.title ?? undefined,
            website: company ? `https://${company.domain}` : undefined,
            custom_variables: {
              [V.subject]: msgs.find((x) => x.step === 0)?.subject ?? "",
              [V.email1]: body(0),
              [V.followup1]: body(1),
              [V.followup2]: body(2),
            },
          };
        });
        const res = await instantly.addLeads(campaignId, payload, `${campaignId}-${batch.map((b) => b.lead.id).join("").slice(0, 60)}-${Date.now()}`);
        const created = new Map((res.created_leads ?? []).map((c) => [c.email.toLowerCase(), c.id]));

        for (const { lead } of batch) {
          const instantlyId = created.get(lead.email.toLowerCase()) ?? "pending";
          await db.update(schema.leads).set({ instantlyLeadId: instantlyId }).where(eq(schema.leads.id, lead.id));
          await db
            .update(schema.messages)
            .set({ status: "queued", provider: "instantly" })
            .where(
              and(eq(schema.messages.leadId, lead.id), eq(schema.messages.kind, "sequence"), eq(schema.messages.status, "approved")),
            );
        }
        await activity(
          project.id,
          `Queued ${res.leads_uploaded ?? batch.length} leads in Instantly for ${seg.name}` +
            ((res.in_blocklist ?? 0) + (res.duplicated_leads ?? 0) + (res.skipped_count ?? 0) > 0
              ? ` (${(res.in_blocklist ?? 0) + (res.duplicated_leads ?? 0) + (res.skipped_count ?? 0)} skipped by Instantly)`
              : ""),
          "success",
        );
        if (i + 100 < rows.length) await new Promise((r) => setTimeout(r, 2000));
      }

      const camp = await instantly.getCampaign(campaignId);
      if (camp.status !== 1) await instantly.activateCampaign(campaignId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[instantly] push failed", msg);
      await activity(project.id, `Couldn't hand emails to Instantly: ${msg}`, "error");
    }
  }
}

// ── Events (webhook + polling) ──────────────────────────────────────────

export type InstantlyEvent = {
  event_type?: string;
  timestamp?: string;
  campaign_id?: string;
  lead_email?: string;
  email_account?: string;
  step?: number | string;
  email_id?: string;
  email_subject?: string;
  email_text?: string;
  email_html?: string;
  reply_subject?: string;
  reply_text?: string;
  reply_html?: string;
  reply_text_snippet?: string;
  is_auto_reply?: boolean | number;
};

async function findLead(campaignId: string | undefined, email: string | undefined): Promise<{ lead: Lead; seg: Segment } | null> {
  if (!campaignId || !email) return null;
  const seg = await db.query.segments.findFirst({ where: eq(schema.segments.instantlyCampaignId, campaignId) });
  if (!seg) return null;
  const lead = await db.query.leads.findFirst({
    where: and(eq(schema.leads.projectId, seg.projectId), sql`lower(${schema.leads.email}) = ${email.toLowerCase()}`),
  });
  return lead ? { lead, seg } : null;
}

async function suppress(value: string, reason: string) {
  await db.insert(schema.suppressions).values({ value: value.toLowerCase(), reason }).onConflictDoNothing();
}

async function cancelQueued(leadId: string) {
  await db
    .update(schema.messages)
    .set({ status: "cancelled" })
    .where(and(eq(schema.messages.leadId, leadId), eq(schema.messages.kind, "sequence"), inArray(schema.messages.status, ["draft", "approved", "queued"])));
}

/** Apply one Instantly event to Kindling's state. Idempotent. Returns a job to run, if any. */
export async function applyInstantlyEvent(ev: InstantlyEvent): Promise<{ handleReplyId?: string } | void> {
  const type = ev.event_type ?? "";
  const found = await findLead(ev.campaign_id, ev.lead_email);
  if (!found) return;
  const { lead, seg } = found;
  const when = ev.timestamp ? new Date(ev.timestamp) : new Date();

  if (type === "email_sent") {
    const step = Math.max(0, Number(ev.step ?? 1) - 1);
    await db
      .update(schema.messages)
      .set({ status: "sent", sentAt: when, externalAccount: ev.email_account ?? null, fromEmail: ev.email_account ?? null })
      .where(and(eq(schema.messages.leadId, lead.id), eq(schema.messages.kind, "sequence"), eq(schema.messages.step, step), inArray(schema.messages.status, ["queued", "approved"])));
    if (lead.status === "drafted") {
      await db.update(schema.leads).set({ status: "contacted", lastContactedAt: when }).where(eq(schema.leads.id, lead.id));
    } else {
      await db.update(schema.leads).set({ lastContactedAt: when }).where(eq(schema.leads.id, lead.id));
    }
    return;
  }

  if (type === "email_bounced") {
    await db.update(schema.leads).set({ status: "bounced" }).where(eq(schema.leads.id, lead.id));
    await suppress(lead.email, "bounce");
    await cancelQueued(lead.id);
    await activity(seg.projectId, `Email to ${lead.email} bounced. Removed from outreach.`, "warning");
    return;
  }

  if (type === "lead_unsubscribed") {
    await db.update(schema.leads).set({ status: "unsubscribed" }).where(eq(schema.leads.id, lead.id));
    await suppress(lead.email, "unsubscribe");
    await cancelQueued(lead.id);
    return;
  }

  if (type === "reply_received" || type === "auto_reply_received") {
    if (!ev.email_id) return;
    const auto = type === "auto_reply_received" || ev.is_auto_reply === true || ev.is_auto_reply === 1;
    const text = (ev.reply_text || (ev.reply_html ? htmlToText(ev.reply_html) : "") || ev.reply_text_snippet || "").slice(0, 8000);
    const [inbound] = await db
      .insert(schema.messages)
      .values({
        projectId: seg.projectId,
        leadId: lead.id,
        segmentId: seg.id,
        direction: "inbound",
        kind: "reply",
        subject: ev.reply_subject ?? ev.email_subject ?? "",
        body: text || "(empty message)",
        status: "received",
        sentAt: when,
        provider: "instantly",
        externalId: ev.email_id,
        externalAccount: ev.email_account ?? null,
        fromEmail: lead.email,
        toEmail: ev.email_account ?? null,
        handled: auto,
        decision: auto
          ? { category: "out_of_office", summary: "Automatic reply", action: "no_reply", replyBody: null, meetingStartIso: null, referralName: null, referralEmail: null }
          : null,
      })
      .onConflictDoNothing()
      .returning();
    if (!inbound || auto) return;

    await cancelQueued(lead.id);
    if (["drafted", "contacted"].includes(lead.status)) {
      await db.update(schema.leads).set({ status: "replied" }).where(eq(schema.leads.id, lead.id));
    }
    await activity(seg.projectId, `New reply from ${lead.firstName ?? lead.email}`, "success");
    await enqueue("handle-reply", { messageId: inbound.id }, { projectId: seg.projectId });
    return { handleReplyId: inbound.id };
  }
}

/**
 * Backup for the webhook: pull recent sent and received campaign emails
 * from Instantly's Unibox and apply anything we missed.
 */
export async function syncInstantly() {
  if (!env.instantlyKey) return;
  const hasCampaigns = await db.query.segments.findFirst({ where: sql`${schema.segments.instantlyCampaignId} is not null` });
  if (!hasCampaigns) return;

  for (const kind of ["received", "sent"] as const) {
    const key = `instantly:cursor:${kind}`;
    const row = await db.query.kv.findFirst({ where: eq(schema.kv.key, key) });
    const since = (row?.value as string | undefined) ?? new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    const { items } = await instantly.listEmails({ email_type: kind, min_timestamp_created: since, limit: 100 });
    let latest = since;
    for (const e of items ?? []) {
      if (!e.campaign_id) continue;
      if (kind === "received") {
        await applyInstantlyEvent({
          event_type: e.is_auto_reply ? "auto_reply_received" : "reply_received",
          campaign_id: e.campaign_id,
          lead_email: e.from_address_email ?? e.lead,
          email_account: e.eaccount,
          email_id: e.id,
          reply_subject: e.subject,
          reply_text: e.body?.text ?? undefined,
          reply_html: e.body?.html ?? undefined,
          timestamp: e.timestamp_email ?? e.timestamp_created,
        });
      } else if (e.ue_type === 1) {
        // Sent by the campaign: find which step by matching what's still queued, in order.
        const found = await findLead(e.campaign_id, e.lead ?? e.to_address_email_list?.split(",")[0]);
        if (found) {
          const next = await db.query.messages.findFirst({
            where: and(eq(schema.messages.leadId, found.lead.id), eq(schema.messages.kind, "sequence"), eq(schema.messages.status, "queued")),
            orderBy: (m, { asc }) => asc(m.step),
          });
          if (next) {
            await applyInstantlyEvent({
              event_type: "email_sent",
              campaign_id: e.campaign_id,
              lead_email: found.lead.email,
              email_account: e.eaccount,
              step: next.step + 1,
              timestamp: e.timestamp_email ?? e.timestamp_created,
            });
          }
        }
      }
      if (e.timestamp_created && e.timestamp_created > latest) latest = e.timestamp_created;
    }
    await db
      .insert(schema.kv)
      .values({ key, value: latest })
      .onConflictDoUpdate({ target: schema.kv.key, set: { value: latest, updatedAt: new Date() } });
  }
}

/** Send an approved reply through the Instantly mailbox that received the prospect's message. */
export async function sendReplyViaInstantly(draft: Message) {
  const inbound = draft.inReplyToId ? await db.query.messages.findFirst({ where: eq(schema.messages.id, draft.inReplyToId) }) : null;
  if (!inbound?.externalId || !inbound.externalAccount) {
    await db.update(schema.messages).set({ status: "failed", error: "Original Instantly email not found" }).where(eq(schema.messages.id, draft.id));
    return;
  }
  const claimed = await db
    .update(schema.messages)
    .set({ status: "sending" })
    .where(and(eq(schema.messages.id, draft.id), eq(schema.messages.status, "approved")))
    .returning({ id: schema.messages.id });
  if (!claimed.length) return;
  const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, draft.projectId) });
  try {
    const sent = await instantly.replyToEmail({
      reply_to_uuid: inbound.externalId,
      eaccount: inbound.externalAccount,
      subject: draft.subject,
      text: project ? renderBody(draft.body, { ...project.settings, optOutLine: "", physicalAddress: "" }) : draft.body,
    });
    await db
      .update(schema.messages)
      .set({ status: "sent", sentAt: new Date(), externalId: sent.id ?? null, externalAccount: inbound.externalAccount, fromEmail: inbound.externalAccount, error: null })
      .where(eq(schema.messages.id, draft.id));
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    await db.update(schema.messages).set({ status: "failed", error: err.slice(0, 1000) }).where(eq(schema.messages.id, draft.id));
    await activity(draft.projectId, `Couldn't send reply through Instantly: ${err}`, "error");
  }
}

/** Stop emailing one lead in Instantly (skip / unsubscribe by hand). */
export async function removeFromInstantly(lead: Lead) {
  if (!env.instantlyKey || !lead.instantlyLeadId || lead.instantlyLeadId === "pending") return;
  await instantly.deleteLead(lead.instantlyLeadId).catch((e) => console.warn("[instantly] delete lead", e));
}

export async function setSegmentCampaignActive(segment: Segment, active: boolean) {
  if (!env.instantlyKey || !segment.instantlyCampaignId) return;
  await (active ? instantly.activateCampaign(segment.instantlyCampaignId) : instantly.pauseCampaign(segment.instantlyCampaignId)).catch((e) =>
    console.warn("[instantly] campaign state", e),
  );
}

/** Register Kindling's webhook in Instantly (idempotent). */
export async function connectWebhook() {
  const target = `${env.appUrl}/api/webhooks/instantly`;
  if (!target.startsWith("https://")) throw new Error(`Webhooks need a public https URL (APP_URL is ${env.appUrl}). Replies are still picked up by polling.`);
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("Set CRON_SECRET first; it authenticates webhook calls.");
  const { items } = await instantly.listWebhooks();
  const existing = (items ?? []).filter((w) => w.target_hook_url === target);
  for (const w of existing) await instantly.deleteWebhook(w.id);
  return instantly.createWebhook({ target_hook_url: target, event_type: "all_events", name: `${APP_NAME} events`, headers: { "x-kindling-secret": secret } });
}

export async function webhookStatus() {
  const target = `${env.appUrl}/api/webhooks/instantly`;
  const { items } = await instantly.listWebhooks();
  const hook = (items ?? []).find((w) => w.target_hook_url === target);
  return hook ? { connected: true, active: hook.status !== -1 } : { connected: false, active: false };
}
