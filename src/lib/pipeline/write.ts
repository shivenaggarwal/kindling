import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { runStructured } from "../ai";
import { fetchPage } from "../sources/site";
import { SequenceSchema, type ProjectSettings } from "../types";
import { getProject, getSegment, projectContext, segmentContext, untrusted } from "./context";

const SYSTEM = `You write cold emails that get replies. You write like a thoughtful founder sending one email by hand, never like a marketing department.

Rules for every sequence:
- Email 1: 50-90 words. Start with "Hi {first name}," on its own line (use "Hi there," if no first name is known, or "Hi {company} team," for a generic inbox).
- Open with one specific, true observation about the prospect's business taken from the research provided. No flattery, no "I came across your website", no "I hope this finds you well".
- Connect that observation to the concrete problem this product solves for this segment, then one line of credibility from the business's real proof points if it fits.
- End with one low-friction question as the call to action (e.g. "Worth sending over a sample?", "Open to a quick look?"). No links, no calendar links, no attachments in email 1.
- Follow-up 1: 30-60 words, adds a new angle or useful detail; reads naturally as a reply in the same thread.
- Follow-up 2: 20-40 words, a polite close-the-loop that makes it easy to say no.
- Plain text only. No markdown, no bullet points, no emojis, no ALL CAPS, at most one exclamation mark in the whole sequence. Avoid spam-trigger phrasing ("free", "guarantee", "act now", "limited time", "100%").
- Never invent facts about the prospect or claims about the product beyond what you're given. If the research is thin, keep the observation modest and accurate.
- Don't write a sign-off or signature; one is appended automatically.
- Subject: 2-6 words, specific, looks like a real person wrote it (e.g. "larksilk x tupelo honey").`;

export function renderBody(body: string, settings: ProjectSettings) {
  const sig = [settings.senderName, settings.senderTitle, settings.signature].filter((s) => s?.trim()).join("\n");
  const footer = [settings.optOutLine, settings.physicalAddress].filter((s) => s?.trim()).join("\n");
  return [body.trim(), sig ? `Best,\n${sig}` : "Best,", footer ? `--\n${footer}` : null].filter(Boolean).join("\n\n");
}

export async function writeSequence(leadId: string) {
  const lead = await db.query.leads.findFirst({ where: eq(schema.leads.id, leadId) });
  if (!lead) return;
  if (!["new", "error"].includes(lead.status)) return; // already written or contacted
  const project = await getProject(lead.projectId);
  if (!lead.segmentId) return;
  const segment = await getSegment(lead.segmentId);
  const company = lead.companyId
    ? await db.query.companies.findFirst({ where: eq(schema.companies.id, lead.companyId) })
    : null;

  await db.update(schema.leads).set({ status: "drafting" }).where(eq(schema.leads.id, leadId));

  try {
    // Light research: the company's homepage, cached on the company row.
    let research = company?.research ?? {};
    if (company && !research.siteExcerpt) {
      const page = await fetchPage(`https://${company.domain}`, 3500);
      if (page) {
        research = { ...research, siteExcerpt: `${page.title}\n${page.description}\n${page.text}` };
        await db.update(schema.companies).set({ research }).where(eq(schema.companies.id, company.id));
      }
    }

    const prospect = [
      `Name: ${[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "(unknown, generic inbox)"}`,
      `Title: ${lead.title ?? "unknown"}`,
      `Email: ${lead.email}${lead.emailStatus === "generic" ? " (shared inbox)" : ""}`,
      `Company: ${company?.name ?? "unknown"} (${company?.domain ?? ""})`,
      company?.location ? `Location: ${company.location}` : null,
      research.whyFit ? `Why they fit: ${research.whyFit}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const seq = await runStructured({
      system: SYSTEM,
      context: `${projectContext(project)}\n\n${segmentContext(segment)}`,
      prompt: [
        `Write the 3-email sequence for this prospect.`,
        `<prospect>\n${prospect}\n</prospect>`,
        research.siteExcerpt ? untrusted("prospect_website", research.siteExcerpt) : "(No website content available.)",
      ].join("\n\n"),
      schema: SequenceSchema,
      effort: "medium",
      maxTokens: 12000,
      usage: { projectId: project.id, segmentId: segment.id, operation: "write-sequence" },
    });

    const status = project.autopilot ? "approved" : "draft";
    const subject = seq.subject.trim();
    await db.transaction(async (tx) => {
      // Replace any earlier unsent drafts for this lead.
      await tx
        .delete(schema.messages)
        .where(and(eq(schema.messages.leadId, leadId), eq(schema.messages.kind, "sequence"), eq(schema.messages.status, "draft")));
      await tx.insert(schema.messages).values(
        [seq.email1, seq.followup1, seq.followup2].map((body, step) => ({
          projectId: project.id,
          leadId,
          segmentId: segment.id,
          direction: "outbound",
          kind: "sequence",
          step,
          subject: step === 0 ? subject : `Re: ${subject}`,
          body: body.trim(),
          status,
          toEmail: lead.email,
        })),
      );
      await tx.update(schema.leads).set({ status: "drafted" }).where(eq(schema.leads.id, leadId));
    });
  } catch (e) {
    await db.update(schema.leads).set({ status: "error" }).where(eq(schema.leads.id, leadId));
    throw e;
  }
}
