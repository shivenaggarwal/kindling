"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/cn";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./ui";

export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  size = "md",
  className,
  confirm,
  formAction,
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  confirm?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      formAction={formAction}
      disabled={pending}
      className={buttonClass(variant, size, className)}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? (
        <>
          <span className="ember-dot inline-block size-1.5 rounded-full bg-current" />
          {pendingText ?? "Working…"}
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function Tabs({ base, tabs }: { base: string; tabs: { href: string; label: string; count?: number }[] }) {
  const pathname = usePathname();
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto">
      {tabs.map((t) => {
        const href = `${base}${t.href}`;
        const active = t.href === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={t.href}
            href={href}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors",
              active ? "border-accent font-medium text-text" : "border-transparent text-muted hover:text-text",
            )}
          >
            {t.label}
            {t.count ? (
              <span className="num rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-4 text-accent-ink">{t.count}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function NavLink({ href, children, exact }: { href: string; children: React.ReactNode; exact?: boolean }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
        active ? "bg-surface-2 font-medium text-text" : "text-muted hover:bg-surface-2 hover:text-text",
      )}
    >
      {children}
    </Link>
  );
}

type FeedItem = { id: string; level: string; message: string; createdAt: string };

const levelDot: Record<string, string> = {
  info: "bg-faint",
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-danger",
};

/** Live agent log. Polls the activity endpoint and refreshes the page when things change. */
export function ActivityFeed({ projectId, initial, busy }: { projectId: string; initial: FeedItem[]; busy: boolean }) {
  const [items, setItems] = useState(initial);
  const [working, setWorking] = useState(busy);
  const router = useRouter();
  const latest = useRef(initial[0]?.createdAt ?? new Date(0).toISOString());

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/activity?after=${encodeURIComponent(latest.current)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { items: FeedItem[]; busy: boolean };
        if (!alive) return;
        if (data.items.length) {
          latest.current = data.items[0].createdAt;
          // Timestamps round to milliseconds, so the newest item can come back again: dedupe by id.
          setItems((prev) => {
            const seen = new Set(prev.map((p) => p.id));
            return [...data.items.filter((i) => !seen.has(i.id)), ...prev].slice(0, 80);
          });
          router.refresh();
        }
        setWorking(data.busy);
      } catch {
        /* offline; try again next tick */
      }
    };
    const id = setInterval(tick, working ? 2500 : 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [projectId, router, working]);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-muted">
        <span className={cn("inline-block size-2 rounded-full", working ? "ember-dot bg-accent" : "bg-faint")} />
        {working ? "Agent is working" : "Agent is idle"}
      </div>
      <ol className="space-y-2.5">
        {items.length === 0 ? <li className="text-sm text-muted">Nothing yet.</li> : null}
        {items.map((it) => (
          <li key={it.id} className="feed-in flex gap-2.5 text-sm">
            <span className={cn("mt-1.5 inline-block size-1.5 shrink-0 rounded-full", levelDot[it.level] ?? levelDot.info)} />
            <div className="min-w-0">
              <div className={cn("leading-snug", it.level === "error" && "text-danger")}>{it.message}</div>
              <div className="num text-[11px] text-faint" suppressHydrationWarning>{new Date(it.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Refresh server data periodically while background work is in flight. */
export function AutoRefresh({ active, every = 4000 }: { active: boolean; every?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), every);
    return () => clearInterval(id);
  }, [active, every, router]);
  return null;
}
