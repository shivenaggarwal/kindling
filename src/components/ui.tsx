import Link from "next/link";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "ai" | "info";

const toneClass: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-border",
  accent: "bg-accent-soft text-accent border-transparent",
  success: "bg-success-soft text-success border-transparent",
  warning: "bg-warning-soft text-warning border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  ai: "bg-ai-soft text-ai border-transparent",
  info: "bg-info-soft text-info border-transparent",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const btnBase =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const btnVariant = {
  primary: "bg-accent text-accent-ink hover:brightness-95 shadow-sm",
  secondary: "bg-surface text-text border border-border hover:bg-surface-2",
  ghost: "text-muted hover:text-text hover:bg-surface-2",
  danger: "bg-surface text-danger border border-border hover:bg-danger-soft",
  dark: "bg-text text-bg hover:opacity-90",
};
const btnSize = { sm: "h-7 px-2.5 text-xs", md: "h-9 px-3.5 text-sm", lg: "h-11 px-5 text-[15px]" };

export type ButtonVariant = keyof typeof btnVariant;
export type ButtonSize = keyof typeof btnSize;

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cn(btnBase, btnVariant[variant], btnSize[size], className);
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: { href: string; variant?: ButtonVariant; size?: ButtonSize; className?: string; children: React.ReactNode } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
>) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-xl border border-border bg-surface", className)}>{children}</div>;
}

export function CardHeader({ title, description, action }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

const field =
  "w-full rounded-lg border border-border bg-surface px-3 text-sm text-text placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, "py-2 leading-relaxed", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(field, "h-9 pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-xs font-medium text-text">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Stat({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={cn("num mt-1 font-display text-[32px] leading-none", accent && "text-accent")}>{value}</div>
      {sub ? <div className="mt-1.5 text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[34px] leading-tight tracking-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-border-strong bg-surface/50 px-6 py-14 text-center">
      <div className="font-display text-2xl">{title}</div>
      {children ? <div className="mt-2 max-w-md text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function FitBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(4, Math.min(100, value))}%` }} />
      </div>
      <span className="num text-xs font-medium">{value}%</span>
    </div>
  );
}

export function Notice({ tone = "warning", children }: { tone?: Tone; children: React.ReactNode }) {
  return <div className={cn("rounded-lg border px-3.5 py-2.5 text-sm", toneClass[tone])}>{children}</div>;
}

export const money = (n: number | null | undefined) =>
  n == null ? "—" : n < 1 ? `$${n.toFixed(2)}` : n < 100 ? `$${n.toFixed(2)}` : `$${Math.round(n).toLocaleString()}`;

export const pct = (n: number) => `${(n * 100).toFixed(n > 0 && n < 0.1 ? 1 : 0)}%`;
