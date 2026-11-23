import { env } from "../config";

/**
 * Instantly API v2 (https://developer.instantly.ai). Instantly is the delivery
 * layer: pre-warmed domains and mailboxes, continuous warm-up, inbox rotation
 * and sending. Kindling stays the brain (research, copy, replies).
 */

// Overridable for tests against a mock server.
const BASE = process.env.INSTANTLY_BASE_URL || "https://api.instantly.ai/api/v2";

export class InstantlyError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

async function api<T>(method: string, path: string, opts: { body?: unknown; query?: Query } = {}): Promise<T> {
  if (!env.instantlyKey) throw new InstantlyError(0, "INSTANTLY_API_KEY is not set", null);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const url = `${BASE}${path}${qs.size ? `?${qs}` : ""}`;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${env.instantlyKey}`,
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get("retry-after")) || 2 ** attempt * 2;
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg =
        (data && typeof data === "object" && ("message" in data ? String(data.message) : "error" in data ? String(data.error) : "")) ||
        text.slice(0, 300);
      const hint =
        res.status === 401
          ? " (check INSTANTLY_API_KEY)"
          : res.status === 403
            ? " (the API key is missing a scope; create it with all:all)"
            : res.status === 402
              ? " (Instantly needs an active paid plan for the API)"
              : "";
      throw new InstantlyError(res.status, `Instantly ${method} ${path} → ${res.status}: ${msg}${hint}`, data);
    }
    return data as T;
  }
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

// ── Accounts ────────────────────────────────────────────────────────────

export type InstantlyAccount = {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  status: number; // 1 active, 2 paused, 3 maintenance, -1 connection error, -2 soft bounce, -3 sending error
  warmup_status: number; // 0 paused, 1 active, -1 banned, -2 spam folder unknown, -3 suspended
  stat_warmup_score?: number | null;
  daily_limit?: number | null;
  provider_code?: number;
  setup_pending?: boolean;
  is_managed_account?: boolean;
  status_message?: unknown;
  timestamp_warmup_start?: string | null;
  timestamp_created?: string;
};

export async function listAccounts(): Promise<InstantlyAccount[]> {
  const out: InstantlyAccount[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r = await api<{ items: InstantlyAccount[]; next_starting_after?: string | null }>("GET", "/accounts", {
      query: { limit: 100, starting_after: cursor },
    });
    out.push(...(r.items ?? []));
    if (!r.next_starting_after) break;
    cursor = r.next_starting_after;
  }
  return out;
}

/** Turn on warm-up for the given accounts (or all). Runs as a background job in Instantly. */
export async function enableWarmup(emails: string[] | "all") {
  return api<{ id: string; status: string }>("POST", "/accounts/warmup/enable", {
    body: emails === "all" ? { include_all_emails: true } : { emails: emails.slice(0, 100) },
  });
}

export const WARMUP_READY_SCORE = 80;

/** Accounts healthy and warm enough to carry cold email. */
export function isReady(a: InstantlyAccount) {
  return a.status === 1 && !a.setup_pending && a.warmup_status === 1 && (a.stat_warmup_score ?? 0) >= WARMUP_READY_SCORE;
}

// ── Campaigns ───────────────────────────────────────────────────────────

export type CampaignInput = {
  name: string;
  campaign_schedule: {
    schedules: { name: string; timing: { from: string; to: string }; days: Record<string, boolean>; timezone: string }[];
  };
  sequences: { steps: { type: "email"; delay: number; delay_unit?: "days"; variants: { subject: string; body: string }[] }[] }[];
  email_list: string[];
  daily_limit?: number | null;
  stop_on_reply: boolean;
  stop_on_auto_reply: boolean;
  text_only: boolean;
  link_tracking: boolean;
  open_tracking: boolean;
  insert_unsubscribe_header: boolean;
  email_gap: number;
  random_wait_max: number;
};

export type InstantlyCampaign = { id: string; name: string; status: number; email_list?: string[] };

export const createCampaign = (c: CampaignInput) => api<InstantlyCampaign>("POST", "/campaigns", { body: c });
export const getCampaign = (id: string) => api<InstantlyCampaign>("GET", `/campaigns/${id}`);
export const patchCampaign = (id: string, patch: Partial<CampaignInput>) =>
  api<InstantlyCampaign>("PATCH", `/campaigns/${id}`, { body: patch });
export const activateCampaign = (id: string) => api<InstantlyCampaign>("POST", `/campaigns/${id}/activate`);
export const pauseCampaign = (id: string) => api<InstantlyCampaign>("POST", `/campaigns/${id}/pause`);
export const addCampaignVariables = (id: string, variables: string[]) =>
  api<InstantlyCampaign>("POST", `/campaigns/${id}/variables`, { body: { variables } });

// ── Leads ───────────────────────────────────────────────────────────────

export type LeadInput = {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  job_title?: string;
  website?: string;
  custom_variables?: Record<string, string | number | boolean | null>;
};

export type BulkAddResult = {
  leads_uploaded?: number;
  in_blocklist?: number;
  duplicated_leads?: number;
  skipped_count?: number;
  invalid_email_count?: number;
  created_leads?: { index: number; id: string; email: string }[];
};

export async function addLeads(campaignId: string, leads: LeadInput[], batchKey: string): Promise<BulkAddResult> {
  return api<BulkAddResult>("POST", "/leads/add", {
    body: {
      campaign_id: campaignId,
      leads,
      skip_if_in_campaign: true,
      verify_leads_on_import: false, // already verified by Kindling (Apollo/Hunter)
      idempotency_key: batchKey.slice(0, 128),
    },
  });
}

export const deleteLead = (id: string) => api<unknown>("DELETE", `/leads/${id}`);

// ── Emails (Unibox) ─────────────────────────────────────────────────────

export type InstantlyEmail = {
  id: string;
  thread_id?: string;
  subject?: string;
  from_address_email?: string;
  to_address_email_list?: string;
  body?: { text?: string | null; html?: string | null };
  eaccount?: string;
  lead?: string;
  campaign_id?: string | null;
  ue_type?: number; // 1 sent from campaign, 2 received, 3 sent, 4 scheduled
  is_auto_reply?: number;
  timestamp_created?: string;
  timestamp_email?: string;
  step?: string | number | null;
};

export async function listEmails(q: {
  email_type?: "received" | "sent";
  min_timestamp_created?: string;
  campaign_id?: string;
  lead?: string;
  limit?: number;
}) {
  return api<{ items: InstantlyEmail[]; next_starting_after?: string | null }>("GET", "/emails", {
    query: { limit: q.limit ?? 100, sort_order: "asc", ...q },
  });
}

export const replyToEmail = (r: { reply_to_uuid: string; eaccount: string; subject: string; text: string }) =>
  api<InstantlyEmail>("POST", "/emails/reply", {
    body: { reply_to_uuid: r.reply_to_uuid, eaccount: r.eaccount, subject: r.subject, body: { text: r.text, html: textToHtml(r.text) } },
  });

// ── Webhooks ────────────────────────────────────────────────────────────

export type InstantlyWebhook = { id: string; target_hook_url: string; event_type?: string | null; status?: number };

export const listWebhooks = () => api<{ items: InstantlyWebhook[] }>("GET", "/webhooks", { query: { limit: 100 } });
export const createWebhook = (w: { target_hook_url: string; event_type: string; name: string; headers: Record<string, string> }) =>
  api<InstantlyWebhook>("POST", "/webhooks", { body: w });
export const deleteWebhook = (id: string) => api<unknown>("DELETE", `/webhooks/${id}`);

// ── Done-for-you / pre-warmed domains & mailboxes ───────────────────────

export const preWarmedDomains = (search?: string) =>
  api<{ domains: string[] }>("POST", "/dfy-email-account-orders/domains/pre-warmed-up-list", {
    body: { extensions: ["com", "org", "co"], ...(search ? { search } : {}) },
  });

export const similarDomains = (domain: string) =>
  api<{ domains: string[] }>("POST", "/dfy-email-account-orders/domains/similar", { body: { domain, tlds: ["com", "org"] } });

export const checkDomains = (domains: string[]) =>
  api<{ results: { domain: string; available: boolean; unavailable_reason?: string }[] }>("POST", "/dfy-email-account-orders/domains/check", {
    body: { domains: domains.slice(0, 50) },
  });

export type DfyOrderItem = {
  domain: string;
  email_provider?: 1 | 2 | 3; // 1 Google, 2 AirMail, 3 Microsoft
  accounts?: { email_address_prefix: string; first_name: string; last_name: string }[];
};

export type DfyOrderResult = {
  order_placed?: boolean;
  order_is_valid?: boolean;
  order_error?: string | null;
  payment_failure_reason?: string | null;
  unavailable_domains?: string[];
  blacklist_domains?: string[];
  invalid_domains?: string[];
  invalid_accounts?: { domain: string; email: string; reason: string }[];
  number_of_domains_ordered?: number;
  number_of_accounts_ordered?: number;
  price_per_account_per_month?: number;
  price_per_domain_per_year?: number;
  total_price_per_month?: number;
  total_price_per_year?: number;
  total_price?: number;
  total_discount?: number;
  simulation?: boolean;
  checkout_required?: boolean;
  checkout_url?: string | null;
  payment_method_last_4_digits?: string | null;
  payment_method_brand?: string | null;
};

export const placeDfyOrder = (o: { items: DfyOrderItem[]; order_type: "dfy" | "pre_warmed_up"; simulation: boolean }) =>
  api<DfyOrderResult>("POST", "/dfy-email-account-orders", { body: o });

// ── Helpers ─────────────────────────────────────────────────────────────

export function textToHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, "<br/>");
}
