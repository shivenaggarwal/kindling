import { env } from "../config";
import { recordUsage } from "../log";

/** Hunter.io v2. Docs: https://hunter.io/api-documentation/v2 */

const BASE = "https://api.hunter.io/v2";

type Ctx = { projectId: string; segmentId?: string | null };

export type HunterEmail = {
  value: string;
  type: "personal" | "generic";
  confidence: number;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  seniority: string | null;
  department: string | null;
  linkedin: string | null;
  verification?: { status: string | null } | null;
};

async function hunter<T>(path: string, params: Record<string, string>): Promise<{ status: number; body: T }> {
  const url = `${BASE}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: { "X-API-KEY": env.hunterKey, accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok && res.status !== 202 && res.status !== 222) {
    const body = await res.text().catch(() => "");
    throw new Error(`Hunter ${path} ${res.status}: ${body.slice(0, 300)}`);
  }
  return { status: res.status, body: (await res.json()) as T };
}

async function bill(ctx: Ctx, operation: string) {
  await recordUsage({
    projectId: ctx.projectId,
    segmentId: ctx.segmentId,
    provider: "hunter",
    operation,
    units: 1,
    costUsd: env.cost.hunterRequest,
  });
}

export async function domainSearch(domain: string, ctx: Ctx, limit = 10) {
  const { body } = await hunter<{ data?: { organization?: string | null; emails?: HunterEmail[] } }>(
    "/domain-search",
    { domain, limit: String(limit), seniority: "senior,executive" },
  );
  await bill(ctx, "domain-search");
  return { organization: body.data?.organization ?? null, emails: body.data?.emails ?? [] };
}

export async function findEmail(domain: string, firstName: string, lastName: string, ctx: Ctx) {
  const { body } = await hunter<{
    data?: { email: string | null; score: number | null; position?: string | null; verification?: { status: string | null } };
  }>("/email-finder", { domain, first_name: firstName, last_name: lastName });
  await bill(ctx, "email-finder");
  return body.data?.email ? body.data : null;
}

/** Returns valid | invalid | accept_all | webmail | disposable | unknown */
export async function verifyEmail(email: string, ctx: Ctx): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { status, body } = await hunter<{ data?: { status?: string } }>("/email-verifier", { email });
    if (status === 200) {
      await bill(ctx, "email-verifier");
      return body.data?.status ?? "unknown";
    }
    // 202 = still verifying, poll again (free); 222 = remote server hiccup.
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
  return "unknown";
}
