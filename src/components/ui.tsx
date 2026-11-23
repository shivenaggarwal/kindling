import Link from "next/link";
import { cn } from "@/lib/cn";
import { Logo } from "./logo";
import { MatrixNumber } from "./matrix";

export { MatrixNumber };

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "ai" | "info";

/** LED colour per tone. Status is carried by the dot; text stays ink. */
const ledClass: Record<Tone, string> = {
  neutral: "bg-faint",
  accent: "bg-signal",
  success: "bg-success",
  warning: "bg-warning-dot",
  danger: "bg-danger",
  ai: "bg-signal led-live",
  info: "bg-text",
};

export function Led({ tone = "neutral", className }: { tone?: Tone; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-[7px] shrink-0 rounded-full", ledClass[tone], className)} />;
}

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] max-w-full items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 pr-2.5 pl-2 text-[12px] font-medium leading-none",
        tone === "neutral" ? "text-muted" : tone === "danger" ? "text-danger" : "text-text",
        className,
      )}
    >
      <Led tone={tone} className="size-1.5" />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

const btnBase =
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium tracking-[-0.01em] transition-[background-color,color,opacity,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text";
const btnVariant = {
  primary: "bg-text text-bg hover:opacity-85",
  secondary: "bg-surface-2 text-text hover:bg-surface-3",
  ghost: "text-muted hover:bg-surface-2 hover:text-text",
  danger: "bg-surface-2 text-danger hover:bg-danger-soft",
  dark: "bg-text text-bg hover:opacity-85",
};
const btnSize = { sm: "h-8 px-3.5 text-[13px]", md: "h-10 px-5 text-[14px]", lg: "h-12 px-6 text-[15px]" };

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

/** A grouped panel: white on the grey canvas, continuous large radius, no shadow. */
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-[22px] bg-surface ring-1 ring-[var(--card-ring)]", className)}>{children}</div>;
}

export function CardHeader({ title, description, action }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
      <div className="min-w-0">
        <h3 className="text-[17px] font-semibold leading-snug tracking-[-0.02em]">{title}</h3>
        {description ? <p className="mt-0.5 max-w-prose text-[13px] leading-snug text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

const field =
  "w-full rounded-[12px] border border-transparent bg-surface-2 px-3.5 text-[14px] text-text placeholder:text-faint transition-[background-color,box-shadow] focus:bg-surface focus:border-border-strong focus:outline-none focus:ring-[3px] focus:ring-[var(--focus)]";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, "py-2.5 leading-relaxed", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(field, "h-10 pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-text">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[12px] leading-snug text-muted">{hint}</span> : null}
    </label>
  );
}

/**
 * One instrument readout: a dot-matrix value over a plain label.
 * Place several inside <Readouts> so they share one panel.
 */
export function Stat({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: boolean }) {
  return (
    <div className="min-w-0 px-5 py-4">
      <div className={cn("flex h-[30px] items-end", accent && "text-signal")}>
        {typeof value === "string" || typeof value === "number" ? <MatrixNumber value={value} size={28} /> : value}
      </div>
      <div className="mt-3 text-[13px] font-medium text-text">{label}</div>
      {sub ? <div className="mt-0.5 text-[12px] leading-snug text-muted">{sub}</div> : null}
    </div>
  );
}

/** A single panel of readouts divided by hairlines. */
export function Readouts({ children, className, cols = 4 }: { children: React.ReactNode; className?: string; cols?: 2 | 3 | 4 | 5 }) {
  const grid = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4", 5: "md:grid-cols-5" }[cols];
  // Hairline dividers come from a 1px gap over the border colour.
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-[22px] bg-[var(--divider)] ring-1 ring-[var(--card-ring)] [&>*]:bg-surface max-md:[&>*:last-child:nth-child(odd)]:col-span-2",
        grid,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[32px] font-bold leading-[1.1] tracking-[-0.035em] md:text-[38px]">{title}</h1>
        {description ? <p className="mt-2 max-w-[60ch] text-[15px] leading-snug text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-[22px] bg-surface px-6 py-16 text-center ring-1 ring-[var(--card-ring)]">
      <Logo size={30} className="text-faint" />
      <div className="mt-5 text-[19px] font-semibold tracking-[-0.02em]">{title}</div>
      {children ? <div className="mt-1.5 max-w-md text-[14px] leading-relaxed text-muted">{children}</div> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

/** Fit score as a ten-dot meter. */
export function FitBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  const lit = Math.round(v / 10);
  return (
    <div className="flex items-center gap-2" title={`${v}% fit`}>
      <div className="flex gap-[3px]" aria-hidden>
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={cn("size-[5px] rounded-full", i < lit ? (v >= 80 ? "bg-signal" : "bg-text") : "bg-dot-off")} />
        ))}
      </div>
      <span className="num text-[12px] font-medium text-muted">{v}</span>
    </div>
  );
}

const noticeClass: Record<Tone, string> = {
  neutral: "bg-surface text-text",
  accent: "bg-signal-soft text-text",
  success: "bg-success-soft text-text",
  warning: "bg-surface text-text",
  danger: "bg-danger-soft text-text",
  ai: "bg-signal-soft text-text",
  info: "bg-surface text-text",
};

export function Notice({ tone = "warning", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={cn("flex items-start gap-3 rounded-[16px] px-4 py-3 text-[14px] leading-snug", noticeClass[tone])}>
      <Led tone={tone === "ai" ? "accent" : tone} className="mt-[6px]" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export const money = (n: number | null | undefined) =>
  n == null ? "–" : n < 100 ? `$${n.toFixed(2)}` : `$${Math.round(n).toLocaleString()}`;

export const pct = (n: number) => `${(n * 100).toFixed(n > 0 && n < 0.1 ? 1 : 0)}%`;
