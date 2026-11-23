import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  doublePrecision,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  BusinessProfile,
  Competitor,
  CompanyResearch,
  ProjectSettings,
  ReplyDecision,
  Targeting,
} from "../types";

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

/** A business we're finding customers for (usually one per domain). */
export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  domain: text("domain").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("analyzing"), // analyzing | ready | error
  profile: jsonb("profile").$type<BusinessProfile>(),
  competitors: jsonb("competitors").$type<Competitor[]>().notNull().default([]),
  settings: jsonb("settings").$type<ProjectSettings>().notNull(),
  autopilot: boolean("autopilot").notNull().default(false),
  error: text("error"),
  createdAt: createdAt(),
});

/** An ideal-customer segment (ICP) inside a project. */
export const segments = pgTable(
  "segments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    fitScore: integer("fit_score").notNull(),
    rationale: text("rationale").notNull(),
    angle: text("angle").notNull(),
    targeting: jsonb("targeting").$type<Targeting>().notNull(),
    status: text("status").notNull().default("proposed"), // proposed | active | paused
    performance: text("performance").notNull().default("testing"), // testing | working | scaling | underperforming
    findingLeads: boolean("finding_leads").notNull().default(false),
    /** Instantly campaign that sends this segment's sequences (when sending via Instantly). */
    instantlyCampaignId: text("instantly_campaign_id"),
    createdAt: createdAt(),
  },
  (t) => [index("segments_project_idx").on(t.projectId)],
);

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    segmentId: uuid("segment_id").references(() => segments.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    domain: text("domain").notNull(),
    location: text("location"),
    phone: text("phone"),
    sources: jsonb("sources").$type<string[]>().notNull().default([]),
    research: jsonb("research").$type<CompanyResearch>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("companies_project_domain_uq").on(t.projectId, t.domain)],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    segmentId: uuid("segment_id").references(() => segments.id, { onDelete: "set null" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    firstName: text("first_name"),
    lastName: text("last_name"),
    title: text("title"),
    email: text("email").notNull(),
    // verified (Apollo) | valid | accept_all | unknown | generic
    emailStatus: text("email_status").notNull().default("unknown"),
    linkedinUrl: text("linkedin_url"),
    source: text("source").notNull(), // apollo | hunter | ai | places
    // new | drafting | drafted | contacted | replied | interested | meeting | not_interested | bounced | unsubscribed | paused | error
    status: text("status").notNull().default("new"),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    instantlyLeadId: text("instantly_lead_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("leads_project_email_uq").on(t.projectId, t.email),
    index("leads_segment_idx").on(t.segmentId),
  ],
);

export const mailboxes = pgTable("mailboxes", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  scopes: text("scopes").notNull(),
  dailyLimit: integer("daily_limit").notNull().default(30),
  active: boolean("active").notNull().default(true),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: createdAt(),
});

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    segmentId: uuid("segment_id").references(() => segments.id, { onDelete: "set null" }),
    mailboxId: uuid("mailbox_id").references(() => mailboxes.id, { onDelete: "set null" }),
    direction: text("direction").notNull(), // outbound | inbound
    kind: text("kind").notNull().default("sequence"), // sequence | reply
    step: integer("step").notNull().default(0),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull(),
    // outbound: draft | approved | sending | sent | failed | cancelled ; inbound: received
    status: text("status").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    gmailMessageId: text("gmail_message_id"),
    gmailThreadId: text("gmail_thread_id"),
    rfcMessageId: text("rfc_message_id"),
    fromEmail: text("from_email"),
    toEmail: text("to_email"),
    // For inbound messages: the AI's read of the reply. For reply drafts: the decision behind them.
    decision: jsonb("decision").$type<ReplyDecision>(),
    handled: boolean("handled").notNull().default(false),
    /** gmail = sent from a connected Gmail mailbox; instantly = sent through Instantly's warmed mailboxes. */
    provider: text("provider").notNull().default("gmail"),
    /** Instantly email id (for replies: the id to reply to). */
    externalId: text("external_id"),
    /** Instantly sending account that sent/received this email. */
    externalAccount: text("external_account"),
    /** For reply drafts: the inbound message being answered. */
    inReplyToId: uuid("in_reply_to_id"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_project_idx").on(t.projectId),
    index("messages_lead_idx").on(t.leadId),
    index("messages_thread_idx").on(t.gmailThreadId),
    uniqueIndex("messages_gmail_id_uq").on(t.gmailMessageId),
    uniqueIndex("messages_external_id_uq").on(t.externalId),
    index("messages_status_sched_idx").on(t.status, t.scheduledAt),
  ],
);

export const meetings = pgTable("meetings", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  segmentId: uuid("segment_id").references(() => segments.id, { onDelete: "set null" }),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  calendarEventId: text("calendar_event_id"),
  meetLink: text("meet_link"),
  createdAt: createdAt(),
});

/** Every paid API call, so we can compute real cost per lead / per segment. */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    segmentId: uuid("segment_id").references(() => segments.id, { onDelete: "set null" }),
    provider: text("provider").notNull(), // anthropic | apollo | hunter | places
    operation: text("operation").notNull(),
    units: doublePrecision("units").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("usage_project_idx").on(t.projectId), index("usage_segment_idx").on(t.segmentId)],
);

/** Human-readable agent log shown live in the UI. */
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    level: text("level").notNull().default("info"), // info | success | warning | error
    message: text("message").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("activities_project_idx").on(t.projectId, t.createdAt)],
);

/** Global do-not-contact list (unsubscribes, bounces, manual blocks). */
export const suppressions = pgTable("suppressions", {
  id: uuid("id").defaultRandom().primaryKey(),
  value: text("value").notNull().unique(), // an email address or a bare domain
  reason: text("reason").notNull(),
  createdAt: createdAt(),
});

/** Postgres-backed job queue consumed by the worker process. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"), // queued | running | done | failed
    runAt: timestamp("run_at", { withTimezone: true }).defaultNow().notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("jobs_pick_idx").on(t.status, t.runAt)],
);

/** Small key/value store for sync cursors and integration state. */
export const kv = pgTable("kv", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Short-lived named leases so overlapping scheduler runs don't step on each other. */
export const leases = pgTable("leases", {
  name: text("name").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type Project = typeof projects.$inferSelect;
export type Segment = typeof segments.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Mailbox = typeof mailboxes.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type Job = typeof jobs.$inferSelect;
