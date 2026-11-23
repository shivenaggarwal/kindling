import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db";
import { runStructured } from "../ai";
import { env } from "../config";
import { activity } from "../log";
import { enqueue } from "../jobs/queue";
import * as apollo from "../sources/apollo";
import * as hunter from "../sources/hunter";
import * as places from "../sources/places";
import { normalizeDomain } from "../sources/site";
import type { Project, Segment } from "../db/schema";
import type { Targeting } from "../types";
import { getProject, getSegment, projectContext, segmentContext } from "./context";

type Source = "ai" | "places" | "apollo" | "hunter";

type Contact = {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string;
  emailStatus: string; // verified | valid | accept_all | unknown | generic
  linkedinUrl: string | null;
  source: Source;
};

type Candidate = {
  name: string;
  domain: string;
  location: string | null;
  phone: string | null;
  sources: Set<Source>;
  whyFit: string | null;
  evidenceUrl: string | null;
  contacts: Contact[];
  /** A named person found by AI research without an email yet. */
  namedPerson: { firstName: string; lastName: string; title: string | null } | null;
};

const GENERIC_LOCAL = /^(info|hello|hi|contact|enquiries|inquiries|sales|office|admin|team|support|mail|bookings|studio|events|orders)$/;

const isGeneric = (email: string) => GENERIC_LOCAL.test(email.split("@")[0] ?? "");
const looksLikeEmail = (s: string | null | undefined): s is string => !!s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** Higher = better match for the people we want to email. */
function titleScore(title: string | null | undefined, t: Targeting): number {
  if (!title) return 5;
  const tl = title.toLowerCase();
  const idx = t.titles.findIndex((x) => tl.includes(x.toLowerCase()));
  if (idx >= 0) return 100 - idx * 4;
  if (/\b(owner|founder|co-founder|ceo|president|managing director|principal|proprietor)\b/.test(tl)) return 60;
  if (/\b(director|head|vp|vice president|chief|partner)\b/.test(tl)) return 45;
  if (/\bmanager|lead\b/.test(tl)) return 25;
  return 10;
}

const AiCompaniesSchema = z.object({
  companies: z.array(
    z.object({
      name: z.string(),
      domain: z.string().describe("The company's own website domain, e.g. acme.com"),
      location: z.string().nullable(),
      whyFit: z.string().describe("One sentence: the evidence that they fit this segment"),
      evidenceUrl: z.string().nullable(),
      contactFirstName: z.string().nullable().describe("Decision maker's first name if found on a reliable source"),
      contactLastName: z.string().nullable(),
      contactTitle: z.string().nullable(),
      contactEmail: z
        .string()
        .nullable()
        .describe("Only an email address you actually saw published (on their site or an official listing). Never guess."),
    }),
  ),
});

async function aiDiscover(project: Project, segment: Segment, count: number, exclude: string[]) {
  const res = await runStructured({
    system: `You are a meticulous B2B lead researcher. You find real, currently operating companies that match a target segment, using web search, and you never invent companies, people or email addresses. Every company must have its own website domain. Prefer companies where you found concrete evidence of fit.`,
    context: projectContext(project),
    prompt: [
      segmentContext(segment),
      `Find ${count} real companies in this segment that would be good prospects.`,
      segment.targeting.locations.length ? `Focus on: ${segment.targeting.locations.join(", ")}.` : null,
      exclude.length ? `Skip these domains (already found):\n${exclude.slice(0, 300).join(", ")}` : null,
      `For each company, if a reliable source names the ${segment.targeting.titles.slice(0, 3).join(" / ")}, include their name and title. Include an email only if you saw it published.`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    schema: AiCompaniesSchema,
    webSearch: 12,
    effort: "medium",
    usage: { projectId: project.id, segmentId: segment.id, operation: "lead-research" },
  });
  return res.companies;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

export async function findLeads(segmentId: string, requested?: number) {
  const segment = await getSegment(segmentId);
  const project = await getProject(segment.projectId);
  const projectId = project.id;
  const target = requested ?? project.settings.leadsPerBatch ?? 25;
  const t = segment.targeting;
  const ctx = { projectId, segmentId };

  try {
    await activity(projectId, `Looking for ${segment.name}…`);

    // What to skip: our own domain, competitors, companies we already have, suppressed domains.
    const existing = await db
      .select({ domain: schema.companies.domain })
      .from(schema.companies)
      .where(eq(schema.companies.projectId, projectId));
    const suppressed = await db.select({ value: schema.suppressions.value }).from(schema.suppressions);
    const suppressedSet = new Set(suppressed.map((s) => s.value));
    const exclude = new Set<string>([
      project.domain,
      ...project.competitors.map((c) => c.domain),
      ...existing.map((e) => e.domain),
      ...suppressed.map((s) => s.value).filter((v) => !v.includes("@")),
    ]);

    const candidates = new Map<string, Candidate>();
    const upsert = (c: Omit<Candidate, "sources" | "contacts" | "namedPerson"> & {
      source: Source;
      contact?: Contact;
      namedPerson?: Candidate["namedPerson"];
    }) => {
      if (exclude.has(c.domain)) return;
      const cur =
        candidates.get(c.domain) ??
        ({
          name: c.name,
          domain: c.domain,
          location: c.location,
          phone: c.phone,
          sources: new Set<Source>(),
          whyFit: c.whyFit,
          evidenceUrl: c.evidenceUrl,
          contacts: [],
          namedPerson: null,
        } satisfies Candidate);
      cur.sources.add(c.source);
      cur.location ??= c.location;
      cur.phone ??= c.phone;
      cur.whyFit ??= c.whyFit;
      cur.evidenceUrl ??= c.evidenceUrl;
      if (c.contact && !cur.contacts.some((x) => x.email === c.contact!.email)) cur.contacts.push(c.contact);
      if (c.namedPerson && !cur.namedPerson) cur.namedPerson = c.namedPerson;
      candidates.set(c.domain, cur);
    };

    // ── 1. Discover companies from every configured source in parallel ──
    const tasks: Promise<void>[] = [];
    const counts: Record<string, number> = {};
    const warn = (src: string, e: unknown) =>
      activity(projectId, `${src} search failed: ${e instanceof Error ? e.message : String(e)}`, "warning");

    tasks.push(
      aiDiscover(project, segment, Math.min(30, Math.ceil(target * 0.8)), [...exclude])
        .then((rows) => {
          for (const r of rows) {
            const domain = normalizeDomain(r.domain);
            if (!domain) continue;
            const email = looksLikeEmail(r.contactEmail) && normalizeDomain(r.contactEmail) ? r.contactEmail.toLowerCase() : null;
            upsert({
              name: r.name,
              domain,
              location: r.location,
              phone: null,
              whyFit: r.whyFit,
              evidenceUrl: r.evidenceUrl,
              source: "ai",
              namedPerson:
                r.contactFirstName && r.contactLastName
                  ? { firstName: r.contactFirstName, lastName: r.contactLastName, title: r.contactTitle }
                  : null,
              contact: email
                ? {
                    firstName: isGeneric(email) ? null : r.contactFirstName,
                    lastName: isGeneric(email) ? null : r.contactLastName,
                    title: isGeneric(email) ? null : r.contactTitle,
                    email,
                    emailStatus: isGeneric(email) ? "generic" : "unknown",
                    linkedinUrl: null,
                    source: "ai",
                  }
                : undefined,
            });
            counts.ai = (counts.ai ?? 0) + 1;
          }
        })
        .catch((e) => warn("AI web research", e)),
    );

    if (env.placesKey && t.placesQueries.length) {
      tasks.push(
        (async () => {
          for (const q of t.placesQueries.slice(0, 3)) {
            const found = await places.textSearch(q, ctx, 1);
            for (const p of found) {
              const domain = normalizeDomain(p.websiteUri);
              if (!domain || /facebook|instagram|google|yelp|linktr|wix|squarespace\.com$/.test(domain)) continue;
              upsert({
                name: p.displayName?.text ?? domain,
                domain,
                location: p.formattedAddress ?? null,
                phone: p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? null,
                whyFit: p.rating ? `Google Maps: ${p.rating}★ from ${p.userRatingCount ?? 0} reviews` : null,
                evidenceUrl: null,
                source: "places",
              });
              counts.places = (counts.places ?? 0) + 1;
            }
          }
        })().catch((e) => warn("Google Maps", e)),
      );
    }

    if (env.apolloKey) {
      tasks.push(
        (async () => {
          const people = await apollo.searchPeople({ targeting: t, perPage: Math.min(100, target * 2) });
          // One person per organisation, best title first.
          const byOrg = new Map<string, apollo.ApolloSearchPerson>();
          for (const p of people.sort((a, b) => titleScore(b.title, t) - titleScore(a.title, t))) {
            const org = p.organization?.name?.toLowerCase();
            if (org && !byOrg.has(org)) byOrg.set(org, p);
          }
          const picks = [...byOrg.values()].slice(0, Math.ceil(target * 0.6));
          if (!picks.length) return;
          const enriched = await apollo.enrichPeople(picks.map((p) => p.id), ctx);
          for (const p of enriched) {
            const domain = normalizeDomain(p.organization?.primary_domain ?? p.organization?.website_url);
            if (!domain || !looksLikeEmail(p.email)) continue;
            upsert({
              name: p.organization?.name ?? domain,
              domain,
              location: [p.organization?.city, p.organization?.country].filter(Boolean).join(", ") || null,
              phone: null,
              whyFit: p.organization?.short_description?.slice(0, 240) ?? null,
              evidenceUrl: null,
              source: "apollo",
              contact: {
                firstName: p.first_name,
                lastName: p.last_name,
                title: p.title,
                email: p.email.toLowerCase(),
                emailStatus: p.email_status === "verified" ? "verified" : "unknown",
                linkedinUrl: p.linkedin_url,
                source: "apollo",
              },
            });
            counts.apollo = (counts.apollo ?? 0) + 1;
          }
        })().catch((e) => warn("Apollo", e)),
      );
    }

    await Promise.all(tasks);
    const found = [...candidates.values()];
    await activity(
      projectId,
      `Found ${found.length} candidate companies (${Object.entries(counts)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ") || "none"})`,
    );
    if (!found.length) return;

    // ── 2. Find decision makers for companies that don't have one yet ──
    const needContact = () =>
      found.filter((c) => !c.contacts.some((x) => x.emailStatus !== "generic")).slice(0, Math.ceil(target * 1.5));

    if (env.apolloKey && needContact().length) {
      try {
        const list = needContact();
        const people = await apollo.searchPeople({
          targeting: t,
          domains: list.map((c) => c.domain),
          perPage: 100,
        });
        const byOrg = new Map<string, apollo.ApolloSearchPerson>();
        for (const p of people.sort((a, b) => titleScore(b.title, t) - titleScore(a.title, t))) {
          const org = p.organization?.name?.toLowerCase();
          if (org && !byOrg.has(org) && titleScore(p.title, t) >= 25) byOrg.set(org, p);
        }
        const enriched = await apollo.enrichPeople([...byOrg.values()].map((p) => p.id).slice(0, list.length), ctx);
        for (const p of enriched) {
          const domain = normalizeDomain(p.organization?.primary_domain ?? p.organization?.website_url);
          const cand = domain ? candidates.get(domain) : undefined;
          if (!cand || !looksLikeEmail(p.email)) continue;
          cand.sources.add("apollo");
          cand.contacts.push({
            firstName: p.first_name,
            lastName: p.last_name,
            title: p.title,
            email: p.email.toLowerCase(),
            emailStatus: p.email_status === "verified" ? "verified" : "unknown",
            linkedinUrl: p.linkedin_url,
            source: "apollo",
          });
        }
      } catch (e) {
        await warn("Apollo contact lookup", e);
      }
    }

    if (env.hunterKey && needContact().length) {
      await mapLimit(needContact(), 4, async (cand) => {
        try {
          // A named person from research → try the email finder first (cheaper, more precise).
          if (cand.namedPerson) {
            const hit = await hunter.findEmail(cand.domain, cand.namedPerson.firstName, cand.namedPerson.lastName, ctx);
            if (hit?.email && (hit.score ?? 0) >= 50) {
              cand.sources.add("hunter");
              cand.contacts.push({
                firstName: cand.namedPerson.firstName,
                lastName: cand.namedPerson.lastName,
                title: cand.namedPerson.title ?? hit.position ?? null,
                email: hit.email.toLowerCase(),
                emailStatus: hit.verification?.status === "valid" ? "valid" : hit.verification?.status === "accept_all" ? "accept_all" : "unknown",
                linkedinUrl: null,
                source: "hunter",
              });
              return;
            }
          }
          const { emails } = await hunter.domainSearch(cand.domain, ctx, 10);
          const best = emails
            .filter((e) => e.type === "personal" && looksLikeEmail(e.value))
            .sort((a, b) => titleScore(b.position, t) + b.confidence / 10 - (titleScore(a.position, t) + a.confidence / 10))[0];
          const fallback = emails.find((e) => e.type === "generic");
          const pick = best ?? fallback;
          if (!pick) return;
          cand.sources.add("hunter");
          cand.contacts.push({
            firstName: pick.first_name,
            lastName: pick.last_name,
            title: pick.position,
            email: pick.value.toLowerCase(),
            emailStatus:
              pick.type === "generic"
                ? "generic"
                : pick.verification?.status === "valid"
                  ? "valid"
                  : pick.verification?.status === "accept_all"
                    ? "accept_all"
                    : "unknown",
            linkedinUrl: pick.linkedin,
            source: "hunter",
          });
        } catch (e) {
          console.warn("hunter lookup failed", cand.domain, e);
        }
      });
    }

    // ── 3. Choose one contact per company, verify, and save ──
    const chosen = found
      .map((c) => {
        const best = [...c.contacts].sort((a, b) => {
          const rank = (x: Contact) =>
            (x.emailStatus === "generic" ? -50 : 0) +
            (x.emailStatus === "verified" || x.emailStatus === "valid" ? 20 : 0) +
            titleScore(x.title, t);
          return rank(b) - rank(a);
        })[0];
        return best ? { company: c, contact: best } : null;
      })
      .filter((x): x is { company: Candidate; contact: Contact } => !!x)
      .filter((x) => !suppressedSet.has(x.contact.email));

    if (env.hunterKey) {
      await mapLimit(chosen, 4, async (x) => {
        if (["verified", "valid"].includes(x.contact.emailStatus)) return;
        try {
          const status = await hunter.verifyEmail(x.contact.email, ctx);
          if (status === "invalid" || status === "disposable") x.contact.emailStatus = "invalid";
          else if (status === "valid") x.contact.emailStatus = x.contact.emailStatus === "generic" ? "generic" : "valid";
          else if (status === "accept_all") x.contact.emailStatus = x.contact.emailStatus === "generic" ? "generic" : "accept_all";
        } catch (e) {
          console.warn("verify failed", x.contact.email, e);
        }
      });
    }

    const usable = chosen.filter((x) => x.contact.emailStatus !== "invalid").slice(0, target);
    const newLeadIds: string[] = [];
    const bySource: Record<string, number> = {};

    for (const { company, contact } of usable) {
      const [co] = await db
        .insert(schema.companies)
        .values({
          projectId,
          segmentId,
          name: company.name,
          domain: company.domain,
          location: company.location,
          phone: company.phone,
          sources: [...company.sources],
          research: { whyFit: company.whyFit ?? undefined, evidenceUrl: company.evidenceUrl ?? undefined },
        })
        .onConflictDoNothing()
        .returning({ id: schema.companies.id });
      if (!co) continue;
      const [lead] = await db
        .insert(schema.leads)
        .values({
          projectId,
          segmentId,
          companyId: co.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          title: contact.title,
          email: contact.email,
          emailStatus: contact.emailStatus,
          linkedinUrl: contact.linkedinUrl,
          source: contact.source,
        })
        .onConflictDoNothing()
        .returning({ id: schema.leads.id });
      if (lead) {
        newLeadIds.push(lead.id);
        bySource[contact.source] = (bySource[contact.source] ?? 0) + 1;
      }
    }

    await activity(
      projectId,
      newLeadIds.length
        ? `Added ${newLeadIds.length} leads to ${segment.name} (${Object.entries(bySource)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")})`
        : `No new reachable decision makers found for ${segment.name} this round`,
      newLeadIds.length ? "success" : "warning",
    );

    for (const id of newLeadIds) await enqueue("write-sequence", { leadId: id }, { projectId });
  } finally {
    await db.update(schema.segments).set({ findingLeads: false }).where(eq(schema.segments.id, segmentId));
  }
}

/** Leads in a segment that haven't been emailed yet. */
export async function unsentLeadCount(segmentId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.leads)
    .where(and(eq(schema.leads.segmentId, segmentId), inArray(schema.leads.status, ["new", "drafting", "drafted"])));
  return row?.n ?? 0;
}
