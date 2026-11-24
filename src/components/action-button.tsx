"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Asterisk, Button, cx } from "./ui";
import type { Result } from "@/app/actions";

/** Calls a server action, shows pending state and the real result/error. */
export function ActionButton({
  action,
  fn,
  args,
  children,
  variant,
  size,
  confirm,
  className,
  onDone,
  disabled,
  title,
}: {
  /** Client-side closure (only from client components). */
  action?: () => Promise<Result>;
  /** Server action reference + arguments (usable from server components). */
  fn?: (...a: any[]) => Promise<Result>; // eslint-disable-line @typescript-eslint/no-explicit-any
  args?: unknown[];
  children: ReactNode;
  variant?: Parameters<typeof Button>[0]["variant"];
  size?: "sm" | "md";
  confirm?: string;
  className?: string;
  onDone?: (r: Result) => void;
  disabled?: boolean;
  title?: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        title={title}
        variant={variant}
        size={size}
        disabled={pending || disabled}
        className={className}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const r = action ? await action() : await fn!(...(args ?? []));
            setMsg(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error });
            if (r.ok) router.refresh();
            onDone?.(r);
            setTimeout(() => setMsg(null), r.ok ? 2500 : 8000);
          });
        }}
      >
        {pending ? <Asterisk className="size-3.5 text-accent" spin /> : null}
        {children}
      </Button>
      {msg && <span className={cx("max-w-xs text-[11.5px]", msg.ok ? "text-ok" : "text-bad")}>{msg.text}</span>}
    </span>
  );
}
