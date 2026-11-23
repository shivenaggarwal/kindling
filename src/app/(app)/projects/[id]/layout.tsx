import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { toggleAutopilot } from "@/lib/actions";
import { SwitchSubmit, Tabs } from "@/components/client";
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
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0">
          <a
            href={`https://${project.domain}`}
            target="_blank"
            rel="noreferrer"
            className="text-[14px] font-medium text-muted transition-colors hover:text-text"
            title="Open the website"
          >
            {project.domain}
          </a>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="truncate text-[32px] font-bold leading-[1.1] tracking-[-0.035em] md:text-[38px]">{project.name}</h1>
            {project.status === "analyzing" ? <Badge tone="ai">Reading the website</Badge> : null}
            {project.status === "error" ? <Badge tone="danger">Needs attention</Badge> : null}
          </div>
        </div>

        <form action={toggleAutopilot.bind(null, id)} className="flex items-center gap-3.5 rounded-[18px] bg-surface py-2.5 pr-3 pl-4 ring-1 ring-[var(--card-ring)]">
          <div className="text-[13px] leading-tight">
            <div className="font-semibold">Autopilot</div>
            <div className="mt-0.5 text-muted">{project.autopilot ? "Sends, replies and books on its own" : "You approve every email"}</div>
          </div>
          <SwitchSubmit on={project.autopilot} label="Autopilot" />
        </form>
      </div>

      <div className="mb-8">
        <Tabs
          base={base}
          tabs={[
            { href: "", label: "Overview" },
            { href: "/segments", label: "Segments" },
            { href: "/leads", label: "Leads" },
            { href: "/outreach", label: "Outreach", count: counts?.drafts ?? 0 },
            { href: "/inbox", label: "Inbox", count: counts?.replies ?? 0 },
            { href: "/campaigns", label: "Results" },
            { href: "/settings", label: "Settings" },
          ]}
        />
      </div>
      {children}
    </div>
  );
}
