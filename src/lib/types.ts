import { z } from "zod";

/**
 * Shapes shared between the database (jsonb columns), the AI pipeline
 * (structured outputs) and the UI. Every AI-facing schema keeps all fields
 * required and uses `.nullable()` for optional values, so it converts cleanly
 * into a strict tool schema.
 */

export const BusinessProfileSchema = z.object({
  companyName: z.string().describe("The company's name"),
  oneLiner: z.string().describe("What they sell, in one plain sentence"),
  offering: z.string().describe("Products/services in more detail: what exactly a customer buys"),
  valueProps: z.array(z.string()).describe("3-6 concrete reasons customers buy from them"),
  pricing: z.string().nullable().describe("Pricing model / price points if discoverable"),
  idealCustomers: z.string().describe("Who appears to buy today, based on evidence on the site"),
  geography: z.string().describe("Where they sell / ship / operate"),
  proofPoints: z.array(z.string()).describe("Social proof: clients, numbers, years in business, awards"),
  tone: z.string().describe("How the brand talks: formal, playful, technical, etc."),
  businessModel: z.enum(["b2b", "b2c", "both"]),
});
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

export const CompetitorSchema = z.object({
  name: z.string(),
  domain: z.string().describe("Bare domain, e.g. acme.com"),
  note: z.string().describe("How they compare / overlap"),
});
export type Competitor = z.infer<typeof CompetitorSchema>;

export const AnalysisSchema = z.object({
  profile: BusinessProfileSchema,
  competitors: z.array(CompetitorSchema).describe("4-8 real direct competitors"),
});

export const TargetingSchema = z.object({
  titles: z.array(z.string()).describe("Job titles of the decision maker to email, most likely first"),
  seniorities: z
    .array(z.enum(["owner", "founder", "c_suite", "partner", "vp", "head", "director", "manager", "senior"]))
    .describe("Seniority levels of the decision maker"),
  industries: z.array(z.string()).describe("Industries of target companies, plain English"),
  keywords: z.array(z.string()).describe("2-5 short keywords that describe target companies, for database search"),
  locations: z.array(z.string()).describe("Countries/regions/cities to target, e.g. 'United States', 'London, UK'"),
  employeeRanges: z
    .array(z.enum(["1,10", "11,20", "21,50", "51,100", "101,200", "201,500", "501,1000", "1001,5000", "5001,10000"]))
    .describe("Company headcount ranges to target"),
  placesQueries: z
    .array(z.string())
    .describe("Google Maps search queries that would surface these businesses, e.g. 'wedding planner in Austin, TX'. Empty if these are not businesses with a local presence."),
});
export type Targeting = z.infer<typeof TargetingSchema>;

export const SegmentProposalSchema = z.object({
  name: z.string().describe("Short segment name, e.g. 'Boutique hotels'"),
  description: z.string().describe("Who exactly is in this segment"),
  fitScore: z.number().int().describe("0-100: how likely this segment buys, given the evidence"),
  rationale: z.string().describe("Why they would buy: the specific pain this product solves for them"),
  angle: z.string().describe("The core message/hook to open with when emailing this segment"),
  targeting: TargetingSchema,
});
export type SegmentProposal = z.infer<typeof SegmentProposalSchema>;

export const SegmentsSchema = z.object({
  segments: z.array(SegmentProposalSchema).describe("5-8 segments, best fit first"),
});

export type ProjectSettings = {
  /** How emails go out. Defaults to Instantly when INSTANTLY_API_KEY is set. */
  sendVia?: "instantly" | "gmail";
  /** Instantly mailboxes this project may send from (empty = all ready mailboxes). */
  instantlyAccounts?: string[];
  senderName: string;
  senderTitle: string;
  signature: string;
  physicalAddress: string;
  bookingUrl: string;
  meetingMinutes: number;
  timezone: string;
  sendWindowStart: number; // hour, 0-23, in `timezone`
  sendWindowEnd: number;
  sendDays: number[]; // 0=Sun … 6=Sat
  mailboxIds: string[]; // empty = all active mailboxes
  followupDays: number[]; // gap in days before each follow-up
  leadsPerBatch: number;
  optOutLine: string;
  extraInstructions: string;
};

export const defaultProjectSettings = (): ProjectSettings => ({
  senderName: "",
  senderTitle: "",
  signature: "",
  physicalAddress: "",
  bookingUrl: "",
  meetingMinutes: 30,
  timezone: "Europe/London",
  sendWindowStart: 9,
  sendWindowEnd: 17,
  sendDays: [1, 2, 3, 4, 5],
  mailboxIds: [],
  followupDays: [3, 4],
  leadsPerBatch: 25,
  optOutLine: "If this isn't relevant, just reply \"unsubscribe\" and I won't email again.",
  extraInstructions: "",
});

export type CompanyResearch = {
  summary?: string;
  whyFit?: string;
  evidenceUrl?: string;
  siteExcerpt?: string;
};

export const SequenceSchema = z.object({
  hook: z.string().describe("The specific observation about their business the email opens with"),
  subject: z.string().describe("Lowercase-feeling, 2-6 words, no clickbait, no emojis"),
  email1: z.string().describe("First email body, plain text, no greeting line placeholder issues, no signature"),
  followup1: z.string().describe("Follow-up #1 body (sent in the same thread), no signature"),
  followup2: z.string().describe("Follow-up #2 body (final, polite close-the-loop), no signature"),
});
export type Sequence = z.infer<typeof SequenceSchema>;

export const ReplyCategory = z.enum([
  "interested",
  "meeting_request",
  "question",
  "referral",
  "not_now",
  "not_interested",
  "unsubscribe",
  "out_of_office",
  "bounce",
  "other",
]);
export type ReplyCategory = z.infer<typeof ReplyCategory>;

export const ReplyDecisionSchema = z.object({
  category: ReplyCategory,
  summary: z.string().describe("One sentence: what the prospect said"),
  action: z.enum(["reply", "book_meeting", "no_reply"]),
  replyBody: z
    .string()
    .nullable()
    .describe("Plain-text reply to send (no signature). Null when action is no_reply."),
  meetingStartIso: z
    .string()
    .nullable()
    .describe("ISO 8601 start time with offset for a meeting the prospect agreed to. Only for book_meeting."),
  referralName: z.string().nullable(),
  referralEmail: z.string().nullable(),
});
export type ReplyDecision = z.infer<typeof ReplyDecisionSchema>;

export const POSITIVE_CATEGORIES: ReplyCategory[] = ["interested", "meeting_request", "question", "referral"];
