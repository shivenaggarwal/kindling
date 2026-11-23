import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { APP_NAME } from "@/lib/config";
import { logout } from "@/lib/actions";
import { NavLink } from "@/components/client";
import { Logo } from "@/components/logo";

export const dynamic = "force-dynamic";
// Server actions here may start background work with after(); give it the full function budget.
export const maxDuration = 300;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const projects = await db
    .select({ id: schema.projects.id, name: schema.projects.name, domain: schema.projects.domain, status: schema.projects.status })
    .from(schema.projects)
    .orderBy(desc(schema.projects.createdAt));

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-bg px-3 py-4 md:flex">
        <Link href="/" className="mb-6 flex items-center gap-2 px-2.5">
          <Logo size={26} />
          <span className="font-display text-[22px] leading-none">{APP_NAME}</span>
        </Link>

        <NavLink href="/" exact>
          Overview
        </NavLink>

        <div className="mt-5 mb-1.5 flex items-center justify-between px-2.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-faint">Projects</span>
          <Link href="/projects/new" className="text-xs text-muted hover:text-accent" title="New project">
            + New
          </Link>
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto">
          {projects.map((p) => (
            <NavLink key={p.id} href={`/projects/${p.id}`}>
              <span
                className={
                  p.status === "analyzing"
                    ? "ember-dot inline-block size-1.5 shrink-0 rounded-full bg-accent"
                    : p.status === "error"
                      ? "inline-block size-1.5 shrink-0 rounded-full bg-danger"
                      : "inline-block size-1.5 shrink-0 rounded-full bg-success"
                }
              />
              <span className="truncate">{p.name}</span>
            </NavLink>
          ))}
          {projects.length === 0 ? <p className="px-2.5 text-xs text-faint">No projects yet</p> : null}
        </div>

        <div className="mt-4 space-y-0.5 border-t border-border pt-3">
          <NavLink href="/settings">Mailboxes & integrations</NavLink>
          <form action={logout}>
            <button className="w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-muted hover:bg-surface-2 hover:text-text">Sign out</button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Compact top bar on small screens */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
          <Link href="/" className="flex items-center gap-2">
            <Logo size={22} />
            <span className="font-display text-xl">{APP_NAME}</span>
          </Link>
          <div className="flex gap-3 text-sm text-muted">
            <Link href="/projects/new">New</Link>
            <Link href="/settings">Settings</Link>
          </div>
        </div>
        <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}
