import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { runStructured } from "../ai/claude";
import { activity } from "../log";
import { enqueue } from "../jobs/queue";
import { crawlSite, normalizeDomain } from "../sources/site";
import { AnalysisSchema } from "../types";
import { getProject, untrusted } from "./context";

const SYSTEM = `You are a sharp B2B market analyst. Given a company's website, you work out exactly what they sell, to whom, and who they compete with. Be concrete and evidence-based: prefer specifics from the site (products, price points, customer names, numbers) over generic marketing language. If the site content is thin or missing, research the company with web search and web fetch. Competitors must be real companies that you have confirmed exist, with their real domains.`;

export async function analyzeProject(projectId: string) {
  const project = await getProject(projectId);
  await activity(projectId, `Reading ${project.domain}…`);

  const pages = await crawlSite(project.domain);
  if (pages.length) {
    await activity(projectId, `Read ${pages.length} page${pages.length > 1 ? "s" : ""} on ${project.domain}`);
  } else {
    await activity(projectId, `Couldn't load ${project.domain} directly, so researching it on the web instead`, "warning");
  }
  const siteText = pages
    .map((p) => `## ${p.url}\nTitle: ${p.title}\nDescription: ${p.description}\n${p.text}`)
    .join("\n\n");

  await activity(projectId, "Studying the business and its competitors…");
  const result = await runStructured({
    system: SYSTEM,
    prompt: [
      `Company website: https://${project.domain}`,
      siteText ? untrusted("site_content", siteText) : "(The site couldn't be fetched. Use web search and web fetch.)",
      project.settings.extraInstructions
        ? `Notes from the business owner:\n${project.settings.extraInstructions}`
        : null,
      "Build the business profile, then find 4-8 real direct competitors (search to confirm each one and get its domain).",
    ]
      .filter(Boolean)
      .join("\n\n"),
    schema: AnalysisSchema,
    webSearch: 6,
    webFetch: pages.length ? 2 : 5,
    effort: "medium",
    usage: { projectId, operation: "analyze" },
  });

  const competitors = result.competitors
    .map((c) => ({ ...c, domain: normalizeDomain(c.domain) ?? c.domain }))
    .filter((c) => c.domain !== project.domain);

  await db
    .update(schema.projects)
    .set({ profile: result.profile, competitors, name: result.profile.companyName || project.name })
    .where(eq(schema.projects.id, projectId));

  await activity(projectId, `Learned what ${result.profile.companyName} sells: ${result.profile.oneLiner}`, "success");
  if (competitors.length) {
    await activity(projectId, `Found ${competitors.length} competitors: ${competitors.map((c) => c.domain).join(", ")}`);
  }
  await enqueue("propose-segments", { projectId }, { projectId });
}
