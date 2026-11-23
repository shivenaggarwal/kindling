import { env } from "../config";
import { recordUsage } from "../log";
import type { Targeting } from "../types";

/**
 * Apollo.io: free people search (no emails) → paid enrichment (1 credit per
 * revealed email). Docs: https://docs.apollo.io/reference/people-api-search
 */

const BASE = "https://api.apollo.io/api/v1";

export type ApolloSearchPerson = {
  id: string;
  first_name: string | null;
  title: string | null;
  has_email?: boolean;
  organization?: { name?: string | null } | null;
};

export type ApolloPerson = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  name?: string | null;
  title: string | null;
  email: string | null;
  email_status: string | null;
  linkedin_url: string | null;
  city?: string | null;
  country?: string | null;
  organization?: {
    name?: string | null;
    primary_domain?: string | null;
    website_url?: string | null;
    short_description?: string | null;
    city?: string | null;
    country?: string | null;
  } | null;
};

function qs(params: Record<string, string | number | boolean | string[] | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(`${k}[]`, x));
    else sp.set(k, String(v));
  }
  return sp.toString();
}

async function apollo<T>(path: string, init: RequestInit & { query?: string } = {}): Promise<T> {
  const url = `${BASE}${path}${init.query ? `?${init.query}` : ""}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "x-api-key": env.apolloKey,
      "content-type": "application/json",
      accept: "application/json",
      "cache-control": "no-cache",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Apollo ${path} ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Free search. Returns people with Apollo ids but no emails or domains. */
export async function searchPeople(opts: {
  targeting?: Targeting;
  domains?: string[];
  perPage?: number;
  page?: number;
}): Promise<ApolloSearchPerson[]> {
  const t = opts.targeting;
  const query = qs({
    "person_titles": t?.titles.slice(0, 15),
    "person_seniorities": t?.seniorities,
    "organization_locations": opts.domains?.length ? undefined : t?.locations,
    "organization_num_employees_ranges": opts.domains?.length ? undefined : t?.employeeRanges,
    "q_organization_domains_list": opts.domains,
    "contact_email_status": ["verified", "likely to engage"],
    q_keywords: opts.domains?.length ? undefined : t?.keywords.slice(0, 3).join(" ") || undefined,
    include_similar_titles: true,
    page: opts.page ?? 1,
    per_page: Math.min(opts.perPage ?? 25, 100),
  });
  const data = await apollo<{ people?: ApolloSearchPerson[] }>("/mixed_people/api_search", {
    method: "POST",
    query,
  });
  return (data.people ?? []).filter((p) => p.has_email !== false);
}

/** Paid enrichment for up to 10 people per call. Reveals work emails. */
export async function enrichPeople(
  ids: string[],
  ctx: { projectId: string; segmentId?: string | null },
): Promise<ApolloPerson[]> {
  const out: ApolloPerson[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const data = await apollo<{ matches?: (ApolloPerson | null)[] }>("/people/bulk_match", {
      method: "POST",
      body: JSON.stringify({
        details: chunk.map((id) => ({ id })),
        reveal_personal_emails: false,
        reveal_phone_number: false,
      }),
    });
    const matches = (data.matches ?? []).filter((m): m is ApolloPerson => !!m);
    out.push(...matches);
    const credits = matches.filter((m) => m.email).length;
    await recordUsage({
      projectId: ctx.projectId,
      segmentId: ctx.segmentId,
      provider: "apollo",
      operation: "bulk_match",
      units: credits,
      costUsd: credits * env.cost.apolloCredit,
      meta: { requested: chunk.length, returned: matches.length },
    });
  }
  return out;
}
