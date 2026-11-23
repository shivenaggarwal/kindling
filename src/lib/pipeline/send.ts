import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "../db";
import type { Mailbox, Message, Project } from "../db/schema";
import { sendMail } from "../google/gmail";
import { activity } from "../log";
import { localParts } from "../time";
import { renderBody } from "./write";

const MIN_GAP_MINUTES = 4; // minimum spacing between sends from one mailbox
const CONTACTABLE = new Set(["drafted", "contacted"]);

function inSendWindow(project: Project, now = new Date()) {
  const s = project.settings;
  const p = localParts(now, s.timezone || "UTC");
  return s.sendDays.includes(p.weekday) && p.hour >= s.sendWindowStart && p.hour < s.sendWindowEnd;
}

async function sentInLast24h(mailboxId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.mailboxId, mailboxId),
        eq(schema.messages.direction, "outbound"),
        eq(schema.messages.kind, "sequence"),
        gte(schema.messages.sentAt, new Date(Date.now() - 24 * 3600 * 1000)),
      ),
    );
  return row?.n ?? 0;
}

async function lastSentAt(mailboxId: string) {
  const [row] = await db
    .select({ at: schema.messages.sentAt })
    .from(schema.messages)
    .where(and(eq(schema.messages.mailboxId, mailboxId), eq(schema.messages.direction, "outbound")))
    .orderBy(desc(schema.messages.sentAt))
    .limit(1);
  return row?.at ?? null;
}

/** The thread's first outbound message (gives us the mailbox + Gmail thread to continue). */
async function threadAnchor(leadId: string) {
  return db.query.messages.findFirst({
    where: and(eq(schema.messages.leadId, leadId), eq(schema.messages.status, "sent"), eq(schema.messages.direction, "outbound")),
    orderBy: asc(schema.messages.sentAt),
  });
}

async function latestInThread(leadId: string) {
  return db.query.messages.findFirst({
    where: and(eq(schema.messages.leadId, leadId), or(eq(schema.messages.status, "sent"), eq(schema.messages.status, "received"))),
    orderBy: desc(sql`coalesce(${schema.messages.sentAt}, ${schema.messages.createdAt})`),
  });
}

export async function deliver(msg: Message, mailbox: Mailbox, project: Project) {
  const lead = await db.query.leads.findFirst({ where: eq(schema.leads.id, msg.leadId) });
  if (!lead) return;

  const anchor = msg.step > 0 || msg.kind === "reply" ? await threadAnchor(lead.id) : null;
  const previous = anchor ? await latestInThread(lead.id) : null;

  // Claim the message so a concurrent tick can't double-send it.
  const claimed = await db
    .update(schema.messages)
    .set({ status: "sending" })
    .where(and(eq(schema.messages.id, msg.id), eq(schema.messages.status, "approved")))
    .returning({ id: schema.messages.id });
  if (!claimed.length) return;

  try {
    const sent = await sendMail(mailbox, {
      to: lead.email,
      fromName: project.settings.senderName || mailbox.displayName,
      subject: msg.subject,
      body: renderBody(msg.body, project.settings),
      threadId: anchor?.gmailThreadId ?? null,
      inReplyTo: previous?.rfcMessageId ?? null,
    });
    const now = new Date();
    await db
      .update(schema.messages)
      .set({
        status: "sent",
        sentAt: now,
        mailboxId: mailbox.id,
        gmailMessageId: sent.id,
        gmailThreadId: sent.threadId,
        rfcMessageId: sent.rfcMessageId,
        fromEmail: mailbox.email,
        error: null,
      })
      .where(eq(schema.messages.id, msg.id));

    if (msg.kind === "sequence") {
      await db
        .update(schema.leads)
        .set({ status: lead.status === "drafted" ? "contacted" : lead.status, lastContactedAt: now })
        .where(eq(schema.leads.id, lead.id));
      // Schedule the next step of the sequence.
      const gapDays = project.settings.followupDays[msg.step] ?? 4;
      await db
        .update(schema.messages)
        .set({ scheduledAt: new Date(now.getTime() + gapDays * 24 * 3600 * 1000) })
        .where(
          and(
            eq(schema.messages.leadId, lead.id),
            eq(schema.messages.kind, "sequence"),
            eq(schema.messages.step, msg.step + 1),
            inArray(schema.messages.status, ["draft", "approved"]),
          ),
        );
    }
    return true;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    const authProblem = /invalid_grant|invalid_client|unauthorized_client|GOOGLE_CLIENT|insufficient.*(scope|permission)|\b401\b/i.test(err);
    const rateLimited = /sending limit|rate ?limit|quota|\b429\b/i.test(err);
    if (authProblem || rateLimited) {
      // A mailbox problem, not a problem with this email: keep it queued.
      await db.update(schema.messages).set({ status: "approved", error: null }).where(eq(schema.messages.id, msg.id));
      await db
        .update(schema.mailboxes)
        .set({ lastError: err.slice(0, 500), ...(authProblem ? { active: false } : {}) })
        .where(eq(schema.mailboxes.id, mailbox.id));
      await activity(
        project.id,
        authProblem
          ? `Paused ${mailbox.email}: Google access failed (${err}). Reconnect it in Mailboxes & integrations.`
          : `${mailbox.email} hit a Gmail sending limit. Will retry later.`,
        "warning",
      );
      return false;
    }
    await db.update(schema.messages).set({ status: "failed", error: err.slice(0, 1000) }).where(eq(schema.messages.id, msg.id));
    await db.update(schema.mailboxes).set({ lastError: err.slice(0, 500) }).where(eq(schema.mailboxes.id, mailbox.id));
    await activity(project.id, `Failed to send to ${lead.email}: ${err}`, "error");
    return false;
  }
}

/**
 * One scheduler tick: replies go out immediately; sequence emails go out
 * inside each project's send window, one per mailbox per tick, respecting
 * daily limits and spacing.
 */
export async function sendDue() {
  const allMailboxes = await db.query.mailboxes.findMany({ where: eq(schema.mailboxes.active, true) });
  if (!allMailboxes.length) return;
  const mailboxById = new Map(allMailboxes.map((m) => [m.id, m]));
  const usedThisTick = new Set<string>();
  const projectCache = new Map<string, Project>();
  const getProj = async (id: string) => {
    if (!projectCache.has(id)) {
      const p = await db.query.projects.findFirst({ where: eq(schema.projects.id, id) });
      if (p) projectCache.set(id, p);
    }
    return projectCache.get(id);
  };

  // 1) Approved replies — send right away from the thread's mailbox.
  const replies = await db.query.messages.findMany({
    where: and(eq(schema.messages.kind, "reply"), eq(schema.messages.status, "approved")),
    limit: 20,
  });
  for (const r of replies) {
    const anchor = await threadAnchor(r.leadId);
    const mb = anchor?.mailboxId ? mailboxById.get(anchor.mailboxId) : undefined;
    const project = await getProj(r.projectId);
    if (!mb || !project) continue;
    await deliver(r, mb, project);
  }

  // 2) Sequence messages that are due.
  const now = new Date();
  const due = await db
    .select({ m: schema.messages, leadStatus: schema.leads.status, segStatus: schema.segments.status })
    .from(schema.messages)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.messages.leadId))
    .leftJoin(schema.segments, eq(schema.segments.id, schema.messages.segmentId))
    .where(
      and(
        eq(schema.messages.kind, "sequence"),
        eq(schema.messages.status, "approved"),
        or(
          and(eq(schema.messages.step, 0), isNull(schema.messages.scheduledAt)),
          lte(schema.messages.scheduledAt, now),
        ),
      ),
    )
    .orderBy(desc(schema.messages.step), asc(schema.messages.createdAt))
    .limit(200);

  const suppressed = new Set((await db.select({ v: schema.suppressions.value }).from(schema.suppressions)).map((r) => r.v));

  for (const { m, leadStatus, segStatus } of due) {
    if (!CONTACTABLE.has(leadStatus)) {
      await db.update(schema.messages).set({ status: "cancelled" }).where(eq(schema.messages.id, m.id));
      continue;
    }
    if (m.step === 0 && segStatus !== "active") continue; // paused/proposed segments hold first emails
    if (m.toEmail && (suppressed.has(m.toEmail) || suppressed.has(m.toEmail.split("@")[1] ?? ""))) {
      await db.update(schema.messages).set({ status: "cancelled" }).where(eq(schema.messages.id, m.id));
      continue;
    }
    const project = await getProj(m.projectId);
    if (!project || !inSendWindow(project, now)) continue;

    // Never send a follow-up before the step before it has gone out.
    if (m.step > 0) {
      const prev = await db.query.messages.findFirst({
        where: and(eq(schema.messages.leadId, m.leadId), eq(schema.messages.kind, "sequence"), eq(schema.messages.step, m.step - 1)),
      });
      if (prev && prev.status !== "sent") continue;
    }

    let mailbox: Mailbox | undefined;
    if (m.step > 0) {
      const anchor = await threadAnchor(m.leadId);
      mailbox = anchor?.mailboxId ? mailboxById.get(anchor.mailboxId) : undefined;
      if (!mailbox) continue;
    } else {
      const allowed = project.settings.mailboxIds.length
        ? allMailboxes.filter((mb) => project.settings.mailboxIds.includes(mb.id))
        : allMailboxes;
      // Pick the allowed mailbox with the most remaining capacity.
      let best: { mb: Mailbox; left: number } | null = null;
      for (const mb of allowed) {
        if (usedThisTick.has(mb.id)) continue;
        const left = mb.dailyLimit - (await sentInLast24h(mb.id));
        if (left > 0 && (!best || left > best.left)) best = { mb, left };
      }
      mailbox = best?.mb;
      if (!mailbox) continue;
    }

    if (usedThisTick.has(mailbox.id)) continue;
    if ((await sentInLast24h(mailbox.id)) >= mailbox.dailyLimit) continue;
    const last = await lastSentAt(mailbox.id);
    const jitter = Math.random() * 3;
    if (last && now.getTime() - last.getTime() < (MIN_GAP_MINUTES + jitter) * 60000) continue;

    usedThisTick.add(mailbox.id);
    await deliver(m, mailbox, project);
  }
}
