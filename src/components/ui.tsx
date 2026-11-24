import clsx from "clsx";
import { timeAgo } from "@/lib/format";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export { clsx as cx };

export function Asterisk({ className, spin }: { className?: string; spin?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={clsx(className, spin && "animate-spin-slow")} aria-hidden>
      {Array.from({ length: 12 }).map((_, i) => (
        <rect key={i} x="11.1" y="1.5" width="1.8" height="8.2" rx="0.9" fill="currentColor" transform={`rotate(${i * 30} 12 12)`} />
      ))}
    </svg>
  );
}

export function Card({ className, children, ...p }: ComponentProps<"div">) {
  return (
    <div className={clsx("card", className)} {...p}>
      {children}
    </div>
  );
}

export function Mono({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={clsx("font-mono text-[11px] tracking-tight text-muted", className)}>{children}</span>;
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("text-[12px] font-medium text-muted", className)}>{children}</div>;
}

type BtnVariant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "accent";
export function buttonClass(variant: BtnVariant = "secondary", size: "sm" | "md" = "md") {
  return clsx(
    "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-[background,transform,box-shadow,color] duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap select-none",
    size === "sm" ? "h-7 px-3 text-[12px]" : "h-9 px-4 text-[13px]",
    variant === "primary" && "bg-ink text-white hover:bg-ink-2",
    variant === "accent" && "bg-accent text-white hover:bg-accent-strong",
    variant === "secondary" && "bg-sunken text-ink hover:bg-line",
    variant === "ghost" && "text-ink-2 hover:bg-sunken",
    variant === "outline" && "border border-ink/80 text-ink hover:bg-ink hover:text-white",
    variant === "danger" && "bg-bad-soft text-bad hover:bg-bad hover:text-white",
  );
}

export function Button({ variant, size, className, ...p }: ComponentProps<"button"> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  return <button className={clsx(buttonClass(variant, size), className)} {...p} />;
}

export function LinkButton({ variant, size, className, ...p }: ComponentProps<typeof Link> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  return <Link className={clsx(buttonClass(variant, size), className)} {...p} />;
}

const TONES = {
  neutral: "bg-sunken text-ink-2",
  accent: "bg-accent-soft text-accent-strong",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  dark: "bg-ink text-white",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 h-5 text-[11px] font-medium whitespace-nowrap", TONES[tone], className)}>{children}</span>;
}

export const STATUS_TONE: Record<string, Tone> = {
  queued: "neutral",
  blocked: "neutral",
  running: "accent",
  completed: "ok",
  failed: "bad",
  cancelled: "neutral",
  pending: "warn",
  approved: "ok",
  executed: "ok",
  rejected: "bad",
  waiting: "warn",
  skipped: "neutral",
  draft: "neutral",
  in_review: "warn",
  scheduled: "accent",
  publishing: "accent",
  published: "ok",
  idle: "neutral",
  attention: "bad",
  disabled: "neutral",
  new: "neutral",
  qualified: "accent",
  contacted: "warn",
  replied: "ok",
  meeting: "ok",
  won: "ok",
  lost: "neutral",
  open: "warn",
  drafted: "accent",
  escalated: "bad",
  closed: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}

export function StatusDot({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-block size-1.5 rounded-full shrink-0",
        status === "running" && "bg-accent animate-pulse-dot",
        status === "attention" && "bg-bad",
        status === "idle" && "bg-accent/35",
        status === "disabled" && "bg-faint",
        className,
      )}
    />
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between animate-rise">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 flex items-center gap-2 text-[12px] text-muted">{eyebrow}</div>}
        <h1 className="display text-[32px] sm:text-[40px]">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-[14px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={clsx("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 className="text-[15px] font-semibold tracking-tight">{children}</h2>
      {right}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-2 px-6 py-10 text-center">
      <Asterisk className="size-5 text-faint" />
      <div className="text-[14px] font-medium">{title}</div>
      {children && <div className="max-w-md text-[13px] text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-line bg-surface px-3 h-9 text-[13px] outline-none transition focus:border-ink/40 focus:ring-4 focus:ring-ink/5 placeholder:text-faint";
export const textareaClass =
  "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[13px] leading-relaxed outline-none transition focus:border-ink/40 focus:ring-4 focus:ring-ink/5 placeholder:text-faint";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[12px] font-medium text-ink-2">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11.5px] text-muted">{hint}</div>}
    </label>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "bad" | "accent" | "ok" }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={clsx("mt-1 text-[26px] font-semibold tracking-tight tabular", tone === "bad" && "text-bad", tone === "accent" && "text-accent-strong", tone === "ok" && "text-ok")}>{value}</div>
      {hint && <div className="mt-0.5 text-[11.5px] text-muted">{hint}</div>}
    </div>
  );
}

/** Relative time label, safe to hydrate (server and client clocks may differ by a minute). */
export function Ago({ d }: { d: Date | string | null | undefined }) {
  return <span suppressHydrationWarning>{timeAgo(d)}</span>;
}
