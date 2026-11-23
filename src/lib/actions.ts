"use server";

import { timingSafeEqual, createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "./db";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "./auth";
import { enqueue } from "./jobs/queue";
import { activity } from "./log";
import { approveReply } from "./pipeline/replies";
import { normalizeDomain } from "./sources/site";
import { isValidTimezone } from "./time";
import { defaultProjectSettings, type ProjectSettings, type Targeting } from "./types";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const list = (fd: FormData, k: string) =>
  str(fd, k)
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

// ── Auth ────────────────────────────────────────────────────────────────

export async function login(_: string | null, fd: FormData): Promise<string | null> {
  const expected = process.env.APP_PASSWORD ?? "";
  if (!expected) return "APP_PASSWORD isn't set in .env";
  const given = str(fd, "password");
  const h = (s: string) => createHash("sha256").update(s).digest();
  if (!timingSafeEqual(h(given), h(expected))) return "Wrong password";
  (await cookies()).set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions);
  const next = str(fd, "next");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// ── Projects ────────────────────────────────────────────────────────────

export async function createProject(_: string | null, fd: FormData): Promise<string | null> {
  const domain = normalizeDomain(str(fd, "website"));
  if (!domain) return "That doesn't look like a website. Try something like acme.com";
  const settings = { ...defaultProjectSettings(), extraInstructions: str(fd, "notes") };
  const [p] = await db
    .insert(schema.projects)
    .values({ domain, name: domain, settings, status: "analyzing" })
    .returning({ id: schema.projects.id });
  await activity(p.id, `New project for ${domain}`);
  await enqueue("analyze-project", { projectId: p.id }, { projectId: p.id });
  redirect(`/projects/${p.id}`);
}

export async function updateProjectSettings(projectId: string, fd: FormData) {
  const p = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
  if (!p) return;
  const tz = str(fd, "timezone");
  const hour = (k: string, d: number) => Math.max(0, Math.min(24, Number(str(fd, k)) || d));
  const settings: ProjectSettings = {
    ...p.settings,
    senderName: str(fd, "senderName"),
    senderTitle: str(fd, "senderTitle"),
    signature: str(fd, "signature"),
    physicalAddress: str(fd, "physicalAddress"),
    bookingUrl: str(fd, "bookingUrl"),
    meetingMinutes: Math.max(10, Math.min(120, Number(str(fd, "meetingMinutes")) || 30)),
    timezone: isValidTimezone(tz) ? tz : p.settings.timezone,
    sendWindowStart: hour("sendWindowStart", 9),
    sendWindowEnd: hour("sendWindowEnd", 17),
    sendDays: fd.getAll("sendDays").map(Number).filter((n) => n >= 0 && n <= 6),
    mailboxIds: fd.getAll("mailboxIds").map(String),
    followupDays: list(fd, "followupDays")
      .map(Number)
      .filter((n) => n > 0 && n < 60)
      .slice(0, 2),
    leadsPerBatch: Math.max(5, Math.min(100, Number(str(fd, "leadsPerBatch")) || 25)),
    optOutLine: str(fd, "optOutLine"),
    extraInstructions: str(fd, "extraInstructions"),
  };
  if (settings.followupDays.length < 2) settings.followupDays = [3, 4];
  await db.update(schema.projects).set({ settings }).where(eq(schema.projects.id, projectId));
  refresh();
}

export async function updateProfile(projectId: string, fd: FormData) {
  const p = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
  if (!p?.profile) return;
  const profile = {
    ...p.profile,
    oneLiner: str(fd, "oneLiner") || p.profile.oneLiner,
    offering: str(fd, "offering") || p.profile.offering,
    valueProps: list(fd, "valueProps"),
    proofPoints: list(fd, "proofPoints"),
    pricing: str(fd, "pricing") || null,
    geography: str(fd, "geography") || p.profile.geography,
  };
  await db.update(schema.projects).set({ profile }).where(eq(schema.projects.id, projectId));
  refresh();
}

export async function toggleAutopilot(projectId: string) {
  const p = await db.query.projects.findFirst({ where: eq(schema.projects.id, projectId) });
  if (!p) return;
  await db.update(schema.projects).set({ autopilot: !p.autopilot }).where(eq(schema.projects.id, projectId));
  await activity(projectId, p.autopilot ? "Autopilot turned off. Emails and replies wait for your approval." : "Autopilot turned on", "info");
  refresh();
}

export async function rerunAnalysis(projectId: string) {
  // Drop proposed segments that never got used, then rebuild everything.
  const unused = await db.query.segments.findMany({
    where: and(eq(schema.segments.projectId, projectId), eq(schema.segments.status, "proposed")),
  });
  for (const s of unused) {
    const lead = await db.query.leads.findFirst({ where: eq(schema.leads.segmentId, s.id) });
    if (!lead) await db.delete(schema.segments).where(eq(schema.segments.id, s.id));
  }
  await db.update(schema.projects).set({ status: "analyzing", error: null }).where(eq(schema.projects.id, projectId));
  await enqueue("analyze-project", { projectId }, { projectId });
  refresh();
}

export async function deleteProject(projectId: string) {
  await db.delete(schema.jobs).where(eq(schema.jobs.projectId, projectId));
  await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  redirect("/");
}

// ── Segments ────────────────────────────────────────────────────────────

export async function setSegmentStatus(segmentId: string, status: "active" | "paused" | "proposed") {
  const [seg] = await db.update(schema.segments).set({ status }).where(eq(schema.segments.id, segmentId)).returning();
  if (seg) await activity(seg.projectId, `${status === "active" ? "Activated" : status === "paused" ? "Paused" : "Reset"} segment: ${seg.name}`);
  refresh();
}

export async function findLeadsForSegment(segmentId: string, fd: FormData) {
  const count = Math.max(5, Math.min(100, Number(str(fd, "count")) || 25));
  const [seg] = await db
    .update(schema.segments)
    .set({ findingLeads: true, status: "active" })
    .where(and(eq(schema.segments.id, segmentId), eq(schema.segments.findingLeads, false)))
    .returning();
  if (!seg) return;
  await enqueue("find-leads", { segmentId, count }, { projectId: seg.projectId });
  refresh();
}

function targetingFrom(fd: FormData, base?: Targeting): Targeting {
  return {
    titles: list(fd, "titles"),
    seniorities: base?.seniorities ?? ["owner", "founder", "c_suite", "director", "head"],
    industries: list(fd, "industries"),
    keywords: list(fd, "keywords"),
    locations: list(fd, "locations"),
    employeeRanges: base?.employeeRanges ?? ["1,10", "11,20", "21,50", "51,100", "101,200"],
    placesQueries: list(fd, "placesQueries"),
  };
}

export async function updateSegment(segmentId: string, fd: FormData) {
  const seg = await db.query.segments.findFirst({ where: eq(schema.segments.id, segmentId) });
  if (!seg) return;
  await db
    .update(schema.segments)
    .set({
      name: str(fd, "name") || seg.name,
      description: str(fd, "description") || seg.description,
      angle: str(fd, "angle") || seg.angle,
      targeting: targetingFrom(fd, seg.targeting),
    })
    .where(eq(schema.segments.id, segmentId));
  refresh();
}

export async function createSegment(projectId: string, fd: FormData) {
  const name = str(fd, "name");
  if (!name) return;
  await db.insert(schema.segments).values({
    projectId,
    name,
    description: str(fd, "description") || name,
    fitScore: 70,
    rationale: "Added manually",
    angle: str(fd, "angle") || "",
    targeting: targetingFrom(fd),
    status: "active",
  });
  refresh();
}

export async function deleteSegment(segmentId: string) {
  await db.delete(schema.segments).where(eq(schema.segments.id, segmentId));
  refresh();
}

// ── Leads & sequences ───────────────────────────────────────────────────

export async function approveLeads(leadIds: string[]) {
  if (!leadIds.length) return;
  await db
    .update(schema.messages)
    .set({ status: "approved" })
    .where(
      and(
        inArray(schema.messages.leadId, leadIds),
        eq(schema.messages.kind, "sequence"),
        eq(schema.messages.status, "draft"),
      ),
    );
  // Approving a lead also activates its segment so first emails can go out.
  const leads = await db.query.leads.findMany({ where: inArray(schema.leads.id, leadIds) });
  const segIds = [...new Set(leads.map((l) => l.segmentId).filter((x): x is string => !!x))];
  if (segIds.length) {
    await db
      .update(schema.segments)
      .set({ status: "active" })
      .where(and(inArray(schema.segments.id, segIds), eq(schema.segments.status, "proposed")));
  }
  refresh();
}

export async function approveLead(leadId: string) {
  await approveLeads([leadId]);
}

export async function approveAllDrafts(projectId: string, segmentId: string | null) {
  const rows = await db
    .selectDistinct({ leadId: schema.messages.leadId })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.projectId, projectId),
        eq(schema.messages.kind, "sequence"),
        eq(schema.messages.status, "draft"),
        segmentId ? eq(schema.messages.segmentId, segmentId) : undefined,
      ),
    );
  await approveLeads(rows.map((r) => r.leadId));
}

export async function skipLead(leadId: string) {
  await db.update(schema.leads).set({ status: "paused" }).where(eq(schema.leads.id, leadId));
  await db
    .update(schema.messages)
    .set({ status: "cancelled" })
    .where(and(eq(schema.messages.leadId, leadId), inArray(schema.messages.status, ["draft", "approved"])));
  refresh();
}

export async function regenerateSequence(leadId: string) {
  const lead = await db.query.leads.findFirst({ where: eq(schema.leads.id, leadId) });
  if (!lead || !["drafted", "error", "new", "paused"].includes(lead.status)) return;
  await db
    .delete(schema.messages)
    .where(and(eq(schema.messages.leadId, leadId), eq(schema.messages.kind, "sequence"), inArray(schema.messages.status, ["draft", "approved", "cancelled"])));
  await db.update(schema.leads).set({ status: "new" }).where(eq(schema.leads.id, leadId));
  await enqueue("write-sequence", { leadId }, { projectId: lead.projectId });
  refresh();
}

export async function updateMessage(messageId: string, fd: FormData) {
  const msg = await db.query.messages.findFirst({ where: eq(schema.messages.id, messageId) });
  if (!msg || !["draft", "approved", "failed"].includes(msg.status)) return;
  const subject = str(fd, "subject");
  await db
    .update(schema.messages)
    .set({ body: str(fd, "body") || msg.body, ...(subject ? { subject } : {}) })
    .where(eq(schema.messages.id, messageId));
  refresh();
}

export async function retryMessage(messageId: string) {
  await db
    .update(schema.messages)
    .set({ status: "approved", error: null })
    .where(and(eq(schema.messages.id, messageId), eq(schema.messages.status, "failed")));
  refresh();
}

// ── Replies ─────────────────────────────────────────────────────────────

export async function approveReplyAction(messageId: string, fd: FormData) {
  await approveReply(messageId, str(fd, "body"));
  refresh();
}

export async function discardReply(messageId: string) {
  await db
    .update(schema.messages)
    .set({ status: "cancelled" })
    .where(and(eq(schema.messages.id, messageId), eq(schema.messages.status, "draft")));
  refresh();
}

export async function setLeadStatus(leadId: string, status: string) {
  const allowed = ["interested", "meeting", "not_interested", "replied", "paused"];
  if (!allowed.includes(status)) return;
  await db.update(schema.leads).set({ status }).where(eq(schema.leads.id, leadId));
  refresh();
}

// ── Mailboxes & suppression ─────────────────────────────────────────────

export async function updateMailbox(mailboxId: string, fd: FormData) {
  const limit = Math.max(1, Math.min(500, Number(str(fd, "dailyLimit")) || 30));
  await db
    .update(schema.mailboxes)
    .set({ dailyLimit: limit, displayName: str(fd, "displayName") || null })
    .where(eq(schema.mailboxes.id, mailboxId));
  refresh();
}

export async function toggleMailbox(mailboxId: string) {
  const mb = await db.query.mailboxes.findFirst({ where: eq(schema.mailboxes.id, mailboxId) });
  if (!mb) return;
  await db.update(schema.mailboxes).set({ active: !mb.active }).where(eq(schema.mailboxes.id, mailboxId));
  refresh();
}

export async function removeMailbox(mailboxId: string) {
  await db.delete(schema.mailboxes).where(eq(schema.mailboxes.id, mailboxId));
  refresh();
}

export async function addSuppression(fd: FormData) {
  const raw = str(fd, "value").toLowerCase();
  const value = raw.includes("@") ? raw : normalizeDomain(raw);
  if (!value) return;
  await db.insert(schema.suppressions).values({ value, reason: "manual" }).onConflictDoNothing();
  refresh();
}

export async function removeSuppression(id: string) {
  await db.delete(schema.suppressions).where(eq(schema.suppressions.id, id));
  refresh();
}
