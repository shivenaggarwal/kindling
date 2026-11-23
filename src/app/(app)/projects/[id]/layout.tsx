import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { toggleAutopilot } from "@/lib/actions";
import { Tabs, SubmitButton } from "@/components/client";
import { Badge } from "@/components/ui";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, id) });
  if (!project) notFound();

  const [counts] = await db
    .select({
      drafts: sql<number>`count(distinct ${schema.messages.leadId}) filter (where ${schema.messages.kind} = 'sequence' and ${schema.messages.status} = 'draft')::int`,
      replies: sql<number>`count(*) filter (where ${schema.messages.kind} = 'reply' and ${schema.messages.status} = 'draft')::int`,
    })
    .from(schema.messages)
    .where(and(eq(schema.messages.projectId, id)));

  const base = `/projects/${id}`;
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="truncate font-display text-[36px] leading-tight tracking-tight">{project.name}</h1>
            {project.status === "analyzing" ? <Badge tone="ai">Analyzing…</Badge> : null}
            {project.status === "error" ? <Badge tone="danger">Needs attention</Badge> : null}
          </div>
          <a href={`https://${project.domain}`} target="_blank" rel="noreferrer" className="text-sm text-muted hover:text-accent">
            {project.domain} ↗
          </a>
        </div>
        <form action={toggleAutopilot.bind(null, id)} className="flex items-center gap-3">
          <div className="text-right text-xs leading-tight text-muted">
            <div className="font-medium text-text">Autopilot {project.autopilot ? "on" : "off"}</div>
            <div>{project.autopilot ? "Sends, replies and books without asking" : "You approve emails and replies"}</div>
          </div>
          <SubmitButton variant={project.autopilot ? "primary" : "secondary"} size="sm" pendingText="…">
            {project.autopilot ? "Turn off" : "Turn on"}
          </SubmitButton>
        </form>
      </div>
      <div className="mb-7 border-b border-border">
        <Tabs
          base={base}
          tabs={[
            { href: "", label: "Overview" },
            { href: "/segments", label: "Segments" },
            { href: "/leads", label: "Leads" },
            { href: "/outreach", label: "Outreach", count: counts?.drafts ?? 0 },
            { href: "/inbox", label: "Inbox", count: counts?.replies ?? 0 },
            { href: "/campaigns", label: "Campaigns" },
            { href: "/settings", label: "Settings" },
          ]}
        />
      </div>
      {children}
    </div>
  );
}
