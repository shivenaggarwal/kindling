import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logout } from "@/lib/actions";
import { NavLink } from "@/components/client";
import { Logo, Wordmark } from "@/components/logo";
import { Led } from "@/components/ui";

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
      <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 p-3 pr-0 md:block">
        <div className="flex h-full flex-col rounded-[24px] bg-surface p-3 ring-1 ring-[var(--card-ring)]">
          <Link href="/" className="mb-7 flex items-center gap-2.5 rounded-[12px] px-3 pt-2 pb-1" aria-label="Kindling home">
            <Logo size={22} />
            <Wordmark className="text-[21px]" />
          </Link>

          <nav className="space-y-0.5" aria-label="Main">
            <NavLink href="/" exact>
              Overview
            </NavLink>
            <NavLink href="/infrastructure">Sending</NavLink>
            <NavLink href="/settings">Mailboxes & keys</NavLink>
          </nav>

          <div className="mt-7 mb-1.5 flex items-center justify-between px-3">
            <span className="text-[13px] font-semibold text-muted">Projects</span>
            <Link
              href="/projects/new"
              className="grid size-6 place-items-center rounded-full bg-surface-2 text-[15px] leading-none text-text transition-colors hover:bg-surface-3"
              title="New project"
              aria-label="New project"
            >
              +
            </Link>
          </div>
          <nav className="scrollbar-none -mx-1 flex-1 space-y-0.5 overflow-y-auto px-1" aria-label="Projects">
            {projects.map((p) => (
              <NavLink key={p.id} href={`/projects/${p.id}`}>
                <Led tone={p.status === "analyzing" ? "ai" : p.status === "error" ? "danger" : "success"} />
                <span className="truncate">{p.name}</span>
              </NavLink>
            ))}
            {projects.length === 0 ? <p className="px-3 py-1 text-[13px] text-faint">Your projects will appear here.</p> : null}
          </nav>

          <form action={logout} className="mt-3 border-t border-border pt-3">
            <button className="flex h-9 w-full items-center rounded-[11px] px-3 text-left text-[14px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Small screens: wordmark and a scrolling row of destinations. */}
        <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur-xl md:hidden">
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <Link href="/" className="flex items-center gap-2" aria-label="Kindling home">
              <Logo size={18} />
              <Wordmark className="text-[18px]" />
            </Link>
            <Link href="/projects/new" className="flex h-8 items-center rounded-full bg-text px-3.5 text-[13px] font-medium text-bg">
              New project
            </Link>
          </div>
          <nav className="scrollbar-none flex gap-1 overflow-x-auto px-3 pb-2.5" aria-label="Main">
            {[
              ["/", "Overview"],
              ["/infrastructure", "Sending"],
              ["/settings", "Mailboxes & keys"],
              ...projects.map((p) => [`/projects/${p.id}`, p.name]),
            ].map(([href, label]) => (
              <Link key={href} href={href} className="shrink-0 rounded-full bg-surface px-3 py-1.5 text-[13px] font-medium whitespace-nowrap">
                {label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-[1120px] px-4 py-8 md:px-10 md:py-12">{children}</main>
      </div>
    </div>
  );
}
