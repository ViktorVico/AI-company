"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLive, type LiveEvent } from "./live";
import { AgentIcon } from "./agent-icon";
import { Asterisk, cx } from "./ui";
import { timeAgo } from "@/lib/format";

const KIND: Record<string, string> = {
  "task.completed": "text-ok",
  "task.failed": "text-bad",
  "task.started": "text-accent-strong",
  "approval.requested": "text-warn",
  "content.published": "text-ok",
  "content.publish_failed": "text-bad",
};

export function ActivityFeed({ initial, agentIds, limit = 30, compact }: { initial: LiveEvent[]; agentIds?: string[]; limit?: number; compact?: boolean }) {
  const { events } = useLive();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const seen = new Set<number>();
  const merged = [...events, ...initial]
    .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .filter((e) => !agentIds || (e.agentId != null && agentIds.includes(e.agentId)))
    .sort((a, b) => b.id - a.id)
    .slice(0, limit);

  if (!merged.length)
    return (
      <div className="px-1 py-8 text-center text-[13px] text-muted">
        No activity yet. Assign an objective or run a workflow — every real execution event shows up here.
      </div>
    );

  return (
    <ol className="space-y-0.5">
      {merged.map((e) => {
        const href = e.taskId ? `/tasks/${e.taskId}` : e.type.startsWith("approval") ? "/approvals" : e.type.startsWith("workflow") ? "/workflows" : undefined;
        const body = (
          <div className={cx("flex gap-3 rounded-xl px-2 py-2 transition-colors", href && "hover:bg-sunken", events.some((x) => x.id === e.id) && "animate-rise")}>
            <span className={cx("mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-sunken", KIND[e.type] ?? "text-ink-2")}>
              {e.agentId ? <AgentIcon id={e.agentId} className="size-3.5" /> : <Asterisk className="size-3" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className={cx("text-[13px] leading-snug text-ink", compact ? "line-clamp-1" : "line-clamp-2")}>{e.message}</div>
              <div className="mt-0.5 font-mono text-[10.5px] text-muted" suppressHydrationWarning>
                {e.type} · {timeAgo(e.createdAt)}
              </div>
            </div>
          </div>
        );
        return <li key={e.id}>{href ? <Link href={href}>{body}</Link> : body}</li>;
      })}
    </ol>
  );
}
