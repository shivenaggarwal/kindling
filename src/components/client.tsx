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
  name,
  value,
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  confirm?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      formAction={formAction}
      disabled={pending}
      className={buttonClass(variant, size, className)}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? (
        <>
          <span className="led-live inline-block size-1.5 rounded-full bg-signal" />
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
    <nav aria-label="Project sections" className="scrollbar-none -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div className="inline-flex gap-0.5 rounded-full bg-surface-3/70 p-1">
        {tabs.map((t) => {
          const href = `${base}${t.href}`;
          const active = t.href === "" ? pathname === base : pathname.startsWith(href);
          return (
            <Link
              key={t.href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] transition-colors",
                active
                  ? "bg-surface font-semibold text-text shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_0.5px_rgb(0_0_0/0.04)]"
                  : "font-medium text-muted hover:text-text",
              )}
            >
              {t.label}
              {t.count ? (
                <span className="num min-w-[18px] rounded-full bg-signal px-1.5 text-center text-[11px] font-bold leading-[18px] text-signal-ink">
                  {t.count}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function NavLink({ href, children, exact }: { href: string; children: React.ReactNode; exact?: boolean }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-[11px] px-3 text-[14px] transition-colors",
        active ? "bg-surface-2 font-semibold text-text" : "font-medium text-muted hover:bg-surface-2/70 hover:text-text",
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
  warning: "bg-warning-dot",
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
      <div className="mb-4 flex items-center gap-2 text-[13px] font-medium" aria-live="polite">
        <span className={cn("inline-block size-2 rounded-full", working ? "led-live bg-signal" : "bg-faint")} />
        <span className={working ? "text-text" : "text-muted"}>{working ? "Working now" : "Idle"}</span>
      </div>
      <ol className="relative space-y-3.5 before:absolute before:top-1 before:bottom-1 before:left-[3px] before:w-px before:bg-border">
        {items.length === 0 ? <li className="pl-5 text-[14px] text-muted">Nothing yet. Steps appear here as the agent works.</li> : null}
        {items.map((it) => (
          <li key={it.id} className="feed-in relative flex gap-3 pl-5 text-[14px]">
            <span className={cn("absolute top-[7px] left-0 inline-block size-[7px] rounded-full ring-[3px] ring-surface", levelDot[it.level] ?? levelDot.info)} />
            <div className="min-w-0 flex-1">
              <div className={cn("leading-snug", it.level === "error" && "text-danger")}>{it.message}</div>
              <div className="num mt-0.5 text-[12px] text-faint" suppressHydrationWarning>
                {new Date(it.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
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

/** A submit button drawn as a switch, for on/off settings that save immediately. */
export function SwitchSubmit({ on, label }: { on: boolean; label: string }) {
  const { pending } = useFormStatus();
  const shown = pending ? !on : on;
  return (
    <button
      type="submit"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={pending}
      className={cn(
        "relative inline-flex h-[30px] w-[50px] shrink-0 items-center rounded-full p-[3px] transition-colors duration-200 disabled:opacity-70",
        shown ? "bg-signal" : "bg-surface-3",
      )}
    >
      <span
        className={cn(
          "size-6 rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.18),0_0_0_0.5px_rgb(0_0_0/0.06)] transition-transform duration-200",
          shown ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}
