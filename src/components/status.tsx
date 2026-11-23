import { Badge } from "./ui";

const LEAD: Record<string, { label: string; tone: Parameters<typeof Badge>[0]["tone"] }> = {
  new: { label: "New", tone: "neutral" },
  drafting: { label: "Writing…", tone: "ai" },
  drafted: { label: "Ready", tone: "info" },
  contacted: { label: "Contacted", tone: "neutral" },
  replied: { label: "Replied", tone: "accent" },
  interested: { label: "Interested", tone: "success" },
  meeting: { label: "Meeting booked", tone: "success" },
  not_interested: { label: "Not interested", tone: "neutral" },
  bounced: { label: "Bounced", tone: "danger" },
  unsubscribed: { label: "Unsubscribed", tone: "neutral" },
  paused: { label: "Skipped", tone: "neutral" },
  error: { label: "Error", tone: "danger" },
};

export function LeadStatus({ status }: { status: string }) {
  const s = LEAD[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const EMAIL: Record<string, { label: string; tone: Parameters<typeof Badge>[0]["tone"] }> = {
  verified: { label: "Verified", tone: "success" },
  valid: { label: "Valid", tone: "success" },
  accept_all: { label: "Catch-all", tone: "warning" },
  unknown: { label: "Unverified", tone: "neutral" },
  generic: { label: "Shared inbox", tone: "neutral" },
  invalid: { label: "Invalid", tone: "danger" },
};

export function EmailStatus({ status }: { status: string }) {
  const s = EMAIL[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const SOURCE: Record<string, string> = { apollo: "Apollo", hunter: "Hunter", ai: "AI research", places: "Google Maps" };
export function SourceBadge({ source }: { source: string }) {
  return <Badge tone={source === "ai" ? "ai" : "neutral"}>{SOURCE[source] ?? source}</Badge>;
}

const PERF: Record<string, { label: string; tone: Parameters<typeof Badge>[0]["tone"] }> = {
  testing: { label: "Testing", tone: "neutral" },
  working: { label: "Working", tone: "info" },
  scaling: { label: "Scaling", tone: "success" },
  underperforming: { label: "Underperforming", tone: "warning" },
};
export function PerfBadge({ performance, status }: { performance: string; status: string }) {
  if (status === "paused") return <Badge tone="neutral">Paused</Badge>;
  if (status === "proposed") return <Badge tone="neutral">Proposed</Badge>;
  const s = PERF[performance] ?? PERF.testing;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const REPLY: Record<string, { label: string; tone: Parameters<typeof Badge>[0]["tone"] }> = {
  interested: { label: "Interested", tone: "success" },
  meeting_request: { label: "Wants a meeting", tone: "success" },
  question: { label: "Question", tone: "info" },
  referral: { label: "Referral", tone: "info" },
  not_now: { label: "Not now", tone: "warning" },
  not_interested: { label: "Not interested", tone: "neutral" },
  unsubscribe: { label: "Unsubscribe", tone: "neutral" },
  out_of_office: { label: "Out of office", tone: "neutral" },
  bounce: { label: "Bounce", tone: "danger" },
  other: { label: "Other", tone: "neutral" },
};
export function ReplyBadge({ category }: { category?: string | null }) {
  if (!category) return <Badge tone="ai">Reading…</Badge>;
  const s = REPLY[category] ?? REPLY.other;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
