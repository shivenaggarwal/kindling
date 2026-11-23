import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { runStructured } from "../ai";
import { activity } from "../log";
import { enqueue } from "../jobs/queue";
import { SegmentsSchema } from "../types";
import { getProject, projectContext } from "./context";

const SYSTEM = `You are a go-to-market strategist who designs outbound campaigns. Your job: decide which customer segments are most likely to buy a product, and who exactly to email at those companies.

Good segments are narrow and reachable: a specific kind of organisation (e.g. "boutique wedding florists in the US", not "small businesses") where you can name the decision maker's job title and explain a concrete, painful problem this product solves for them. Score fit honestly: high scores need a clear trigger or pain plus ability to pay. Mix proven segments (resembling existing customers) with a couple of adjacent bets. Use web search when it helps you sanity-check that a segment exists in meaningful numbers or understand its buying behaviour.

For targeting: titles should be the real person who would say yes (owner/founder for small companies, a functional head for larger ones). Locations should match where the business can actually serve. Only include Google Maps queries for segments that are local, physical businesses findable on Maps.`;

export async function proposeSegments(projectId: string) {
  const project = await getProject(projectId);
  await activity(projectId, "Figuring out who buys this…");

  const result = await runStructured({
    system: SYSTEM,
    context: projectContext(project),
    prompt:
      "Propose 5-8 customer segments for outbound email, best fit first. For each, give the targeting filters we'll use to find companies and decision makers.",
    schema: SegmentsSchema,
    webSearch: 4,
    effort: "medium",
    usage: { projectId, operation: "segments" },
  });

  const proposals = [...result.segments].sort((a, b) => b.fitScore - a.fitScore);
  const inserted = await db
    .insert(schema.segments)
    .values(
      proposals.map((s) => ({
        projectId,
        name: s.name,
        description: s.description,
        fitScore: Math.max(0, Math.min(100, Math.round(s.fitScore))),
        rationale: s.rationale,
        angle: s.angle,
        targeting: s.targeting,
      })),
    )
    .returning();

  await db.update(schema.projects).set({ status: "ready" }).where(eq(schema.projects.id, projectId));
  await activity(
    projectId,
    `Proposed ${inserted.length} customer segments. Best fit: ${inserted[0]?.name} (${inserted[0]?.fitScore}%)`,
    "success",
  );

  if (project.autopilot) {
    for (const seg of inserted.slice(0, 3)) {
      await db.update(schema.segments).set({ status: "active", findingLeads: true }).where(eq(schema.segments.id, seg.id));
      await enqueue("find-leads", { segmentId: seg.id }, { projectId });
    }
    await activity(projectId, "Autopilot: activated the top 3 segments and started finding leads");
  }
}
