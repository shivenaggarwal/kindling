import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { APP_NAME } from "../config";
import { runStructured } from "../ai/claude";
import type { Mailbox, Message } from "../db/schema";
import { createMeeting, freeSlots } from "../google/calendar";
import { hasCalendar } from "../google/client";
import { getMail, listRecentIncoming } from "../google/gmail";
import { activity } from "../log";
import { enqueue } from "../jobs/queue";
import { ReplyDecisionSchema, type ReplyDecision } from "../types";
import { getProject, projectContext, segmentContext, untrusted } from "./context";

const BOUNCE_FROM = /(mailer-daemon|postmaster|mail delivery subsystem)/i;

async function suppress(value: string, reason: string) {
  await db.insert(schema.suppressions).values({ value: value.toLowerCase(), reason }).onConflictDoNothing();
}

async function cancelPendingSequence(leadId: string) {
  await db
    .update(schema.messages)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(schema.messages.leadId, leadId),
        eq(schema.messages.kind, "sequence"),
        inArray(schema.messages.status, ["draft", "approved", "queued"]),
      ),
    );
}

/** The Google account used for calendar booking: the reply's own mailbox if it has Calendar, else any connected one. */
async function calendarAccount(preferredId?: string | null) {
  if (preferredId) {
    const mb = await db.query.mailboxes.findFirst({ where: eq(schema.mailboxes.id, preferredId) });
    if (mb && hasCalendar(mb)) return mb;
  }
  const all = await db.query.mailboxes.findMany({ where: eq(schema.mailboxes.active, true) });
  return all.find(hasCalendar) ?? null;
}

/** Pull new replies on threads we started, for every connected mailbox. */
export async function pollReplies(opts: { minIntervalMs?: number } = {}) {
  const mailboxes = await db.query.mailboxes.findMany({ where: eq(schema.mailboxes.active, true) });
  for (const mb of mailboxes) {
    if (opts.minIntervalMs && mb.lastPolledAt && Date.now() - mb.lastPolledAt.getTime() < opts.minIntervalMs) continue;
    try {
      await pollMailbox(mb);
      await db.update(schema.mailboxes).set({ lastPolledAt: new Date(), lastError: null }).where(eq(schema.mailboxes.id, mb.id));
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      console.error("poll failed", mb.email, err);
      await db.update(schema.mailboxes).set({ lastError: err.slice(0, 500) }).where(eq(schema.mailboxes.id, mb.id));
    }
  }
}

async function pollMailbox(mb: Mailbox) {
  const recent = await listRecentIncoming(mb);
  if (!recent.length) return;
  const threadIds = [...new Set(recent.map((r) => r.threadId))];

  const anchors = await db
    .select()
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.mailboxId, mb.id),
        eq(schema.messages.direction, "outbound"),
        inArray(schema.messages.gmailThreadId, threadIds),
      ),
    );
  if (!anchors.length) return;
  const anchorByThread = new Map<string, Message>();
  for (const a of anchors) if (a.gmailThreadId && !anchorByThread.has(a.gmailThreadId)) anchorByThread.set(a.gmailThreadId, a);

  const candidates = recent.filter((r) => anchorByThread.has(r.threadId));
  const known = await db
    .select({ id: schema.messages.gmailMessageId })
    .from(schema.messages)
    .where(inArray(schema.messages.gmailMessageId, candidates.map((c) => c.id)));
  const knownSet = new Set(known.map((k) => k.id));

  for (const c of candidates) {
    if (knownSet.has(c.id)) continue;
    const anchor = anchorByThread.get(c.threadId)!;
    const mail = await getMail(mb, c.id);
    if (mail.fromEmail === mb.email.toLowerCase()) continue;

    const isBounce = BOUNCE_FROM.test(mail.from);
    const [inbound] = await db
      .insert(schema.messages)
      .values({
        projectId: anchor.projectId,
        leadId: anchor.leadId,
        segmentId: anchor.segmentId,
        mailboxId: mb.id,
        direction: "inbound",
        kind: "reply",
        subject: mail.subject,
        body: mail.text || "(empty message)",
        status: "received",
        sentAt: mail.date,
        gmailMessageId: mail.id,
        gmailThreadId: mail.threadId,
        rfcMessageId: mail.rfcMessageId,
        fromEmail: mail.fromEmail,
        toEmail: mb.email,
        handled: isBounce,
      })
      .onConflictDoNothing()
      .returning();
    if (!inbound) continue;

    const lead = await db.query.leads.findFirst({ where: eq(schema.leads.id, anchor.leadId) });
    if (!lead) continue;
    await cancelPendingSequence(lead.id);

    if (isBounce) {
      await db.update(schema.leads).set({ status: "bounced" }).where(eq(schema.leads.id, lead.id));
      await suppress(lead.email, "bounce");
      await db
        .update(schema.messages)
        .set({
          decision: {
            category: "bounce",
            summary: "Delivery failed",
            action: "no_reply",
            replyBody: null,
            meetingStartIso: null,
            referralName: null,
            referralEmail: null,
          },
        })
        .where(eq(schema.messages.id, inbound.id));
      await activity(anchor.projectId, `Email to ${lead.email} bounced. Removed from outreach.`, "warning");
      continue;
    }

    if (["drafted", "contacted"].includes(lead.status)) {
      await db.update(schema.leads).set({ status: "replied" }).where(eq(schema.leads.id, lead.id));
    }
    await activity(anchor.projectId, `New reply from ${lead.firstName ?? lead.email}`, "success");
    await enqueue("handle-reply", { messageId: inbound.id }, { projectId: anchor.projectId });
  }
}

const SYSTEM = `You handle replies to outbound sales emails on behalf of a business. You read the whole thread, classify the prospect's latest message, and draft the response a sharp, friendly founder would send.

Guidelines:
- Answer questions directly and briefly using only facts from the business profile. If you don't know something, say you'll check and come back (never invent prices, features or guarantees).
- If they're interested, move toward a meeting: propose two specific times from the available slots, or share the booking link if direct booking isn't available.
- If they accept a specific time that's in the available slots (or clearly propose one inside working hours), choose action "book_meeting" with that exact start time, and write a short confirmation saying an invite is on its way.
- Referrals: thank them, and if they named someone, capture the name/email.
- "Not now": acknowledge warmly, no pressure; action "reply" with one line, or "no_reply" if nothing is needed.
- Not interested / unsubscribe: no reply (action "no_reply").
- Out of office or auto-replies: no reply.
- Keep replies under 80 words, plain text, no signature (it's appended automatically), match their tone and language.`;

export async function handleReply(messageId: string) {
  const inbound = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
  if (!inbound || inbound.direction !== "inbound") return;
  const project = await getProject(inbound.projectId);
  const lead = await db.query.leads.findFirst({ where: eq(schema.leads.id, inbound.leadId) });
  if (!lead) return;
  const segment = lead.segmentId ? await db.query.segments.findFirst({ where: eq(schema.segments.id, lead.segmentId) }) : null;
  const company = lead.companyId ? await db.query.companies.findFirst({ where: eq(schema.companies.id, lead.companyId) }) : null;
  const mailbox = await calendarAccount(inbound.mailboxId);

  const thread = await db.query.messages.findMany({
    where: and(eq(schema.messages.leadId, lead.id), inArray(schema.messages.status, ["sent", "received"])),
    orderBy: asc(sql`coalesce(${schema.messages.sentAt}, ${schema.messages.createdAt})`),
  });
  const transcript = thread
    .map((m) => `[${m.direction === "outbound" ? "US" : "PROSPECT"} · ${m.sentAt?.toISOString() ?? ""}]\n${m.body}`)
    .join("\n\n---\n\n");

  const s = project.settings;
  let slotsText = "Direct calendar booking is not available.";
  const canBook = !!mailbox && hasCalendar(mailbox);
  if (canBook) {
    try {
      const slots = await freeSlots(mailbox, s.timezone, s.meetingMinutes);
      slotsText = slots.length
        ? `Direct booking is available. Open ${s.meetingMinutes}-minute slots (${s.timezone}):\n${slots.map((x) => `- ${x.label} → ${x.iso}`).join("\n")}`
        : "Direct booking is available but the calendar has no open slots this week; ask what suits them.";
    } catch (e) {
      slotsText = "Calendar couldn't be read; ask what time suits them.";
      console.warn("freebusy failed", e);
    }
  }

  const decision = await runStructured({
    system: SYSTEM,
    context: `${projectContext(project)}${segment ? `\n\n${segmentContext(segment)}` : ""}`,
    prompt: [
      `Prospect: ${[lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.email}, ${lead.title ?? ""} at ${company?.name ?? ""}`,
      `Now: ${new Date().toISOString()}`,
      slotsText,
      s.bookingUrl ? `Booking link (use if direct booking isn't possible): ${s.bookingUrl}` : null,
      untrusted("email_thread", transcript),
      "Classify the prospect's latest message and decide what to do.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    schema: ReplyDecisionSchema,
    effort: "medium",
    maxTokens: 8000,
    usage: { projectId: project.id, segmentId: lead.segmentId, operation: "handle-reply" },
  });

  await db.update(schema.messages).set({ decision, handled: true }).where(eq(schema.messages.id, inbound.id));

  // Lead status from the category.
  const statusByCategory: Partial<Record<ReplyDecision["category"], string>> = {
    interested: "interested",
    meeting_request: "interested",
    question: "interested",
    referral: "interested",
    not_now: "replied",
    not_interested: "not_interested",
    unsubscribe: "unsubscribed",
  };
  const nextStatus = statusByCategory[decision.category];
  if (nextStatus && lead.status !== "meeting") {
    await db.update(schema.leads).set({ status: nextStatus }).where(eq(schema.leads.id, lead.id));
  }
  if (decision.category === "unsubscribe" || decision.category === "not_interested") {
    await suppress(lead.email, decision.category);
  }
  if (decision.category === "out_of_office") {
    // Resume the (already approved) sequence a week later: the next step is scheduled, later steps follow it as usual.
    const remaining = await db.query.messages.findMany({
      where: and(eq(schema.messages.leadId, lead.id), eq(schema.messages.kind, "sequence"), eq(schema.messages.status, "cancelled")),
      orderBy: asc(schema.messages.step),
    });
    for (const [i, m] of remaining.entries()) {
      await db
        .update(schema.messages)
        .set({ status: "approved", scheduledAt: i === 0 ? new Date(Date.now() + 7 * 24 * 3600 * 1000) : null })
        .where(eq(schema.messages.id, m.id));
    }
    await db.update(schema.leads).set({ status: "contacted" }).where(eq(schema.leads.id, lead.id));
  }

  await activity(project.id, `${lead.firstName ?? lead.email} (${decision.category.replace("_", " ")}): ${decision.summary}`);

  if (decision.action === "no_reply" || !decision.replyBody) return;

  const subject = inbound.subject.toLowerCase().startsWith("re:") ? inbound.subject : `Re: ${inbound.subject}`;
  const [draft] = await db
    .insert(schema.messages)
    .values({
      projectId: project.id,
      leadId: lead.id,
      segmentId: lead.segmentId,
      mailboxId: inbound.mailboxId,
      direction: "outbound",
      kind: "reply",
      subject,
      body: decision.replyBody,
      status: "draft",
      toEmail: lead.email,
      decision,
      provider: inbound.provider,
      inReplyToId: inbound.id,
      externalAccount: inbound.externalAccount,
    })
    .returning();

  if (project.autopilot) await approveReply(draft.id);
}

/**
 * Approve a reply draft: if it confirms a meeting, create the calendar event
 * first (Google emails the invite), then queue the reply for sending.
 */
export async function approveReply(messageId: string, overrideBody?: string) {
  const draft = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
  if (!draft || draft.kind !== "reply" || draft.status !== "draft") return;
  const body = overrideBody?.trim() || draft.body;

  if (draft.decision?.action === "book_meeting" && draft.decision.meetingStartIso) {
    const project = await getProject(draft.projectId);
    const lead = await db.query.leads.findFirst({ where: eq(schema.leads.id, draft.leadId) });
    const mailbox = await calendarAccount(draft.mailboxId);
    const start = new Date(draft.decision.meetingStartIso);
    if (lead && mailbox && hasCalendar(mailbox) && !Number.isNaN(start.getTime()) && start.getTime() > Date.now()) {
      const company = lead.companyId ? await db.query.companies.findFirst({ where: eq(schema.companies.id, lead.companyId) }) : null;
      const s = project.settings;
      const ev = await createMeeting(mailbox, {
        summary: `${project.profile?.companyName ?? project.name} × ${company?.name ?? lead.email}`,
        description: `Intro call with ${[lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.email}${lead.title ? ` (${lead.title})` : ""}.\nBooked by ${APP_NAME}.`,
        start,
        minutes: s.meetingMinutes,
        attendeeEmail: lead.email,
        tz: s.timezone,
      });
      await db.insert(schema.meetings).values({
        projectId: project.id,
        leadId: lead.id,
        segmentId: lead.segmentId,
        startAt: start,
        endAt: ev.end,
        calendarEventId: ev.eventId,
        meetLink: ev.meetLink,
      });
      await db.update(schema.leads).set({ status: "meeting" }).where(eq(schema.leads.id, lead.id));
      await activity(project.id, `Meeting booked with ${lead.firstName ?? lead.email} for ${start.toUTCString()}`, "success");
    }
  }

  await db.update(schema.messages).set({ status: "approved", body }).where(eq(schema.messages.id, messageId));
}
