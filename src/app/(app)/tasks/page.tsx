import Link from "next/link";
import { db, schema } from "@/db";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { DEPARTMENTS } from "@/server/agents/catalog";
import { AgentIcon } from "@/components/agent-icon";
import { Card, cx, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { duration, timeAgo, usd } from "@/lib/format";

export const metadata = { title: "Tasks" };

const STATUSES = ["all", "running", "queued", "blocked", "completed", "failed", "cancelled"];

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ status?: string; department?: string; agent?: string }> }) {
  const sp = await searchParams;
  const agents = await db.select({ id: schema.agents.id, name: schema.agents.name, department: schema.agents.department }).from(schema.agents);
  const conds: SQL[] = [];
  if (sp.status && sp.status !== "all") conds.push(eq(schema.tasks.status, sp.status));
  if (sp.agent) conds.push(eq(schema.tasks.agentId, sp.agent));
  if (sp.department) conds.push(inArray(schema.tasks.agentId, agents.filter((a) => a.department === sp.department).map((a) => a.id)));
  const tasks = await db.select().from(schema.tasks).where(conds.length ? and(...conds) : undefined).orderBy(desc(schema.tasks.createdAt)).limit(150);
  const name = new Map(agents.map((a) => [a.id, a.name]));
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v && v !== "all") as [string, string][]);
    return `/tasks${p.size ? `?${p}` : ""}`;
  };

  return (
    <div>
      <PageHeader title="Tasks" subtitle="Every unit of work the company has done, with its inputs, outputs, cost and full execution trace." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="scroll-thin flex gap-1 overflow-x-auto">
          {STATUSES.map((s) => (
            <Link key={s} href={qs({ status: s })} className={cx("h-8 shrink-0 rounded-full px-3 text-[12.5px] leading-8", (sp.status ?? "all") === s ? "bg-ink text-white" : "text-ink-2 hover:bg-surface")}>
              {s}
            </Link>
          ))}
        </div>
        <div className="flex gap-1 overflow-x-auto scroll-thin">
          <Link href={qs({ department: undefined })} className={cx("h-8 shrink-0 rounded-full px-3 text-[12.5px] leading-8", !sp.department ? "bg-surface font-medium shadow-sm" : "text-muted hover:bg-surface")}>
            All departments
          </Link>
          {DEPARTMENTS.map((d) => (
            <Link key={d.id} href={qs({ department: d.id })} className={cx("h-8 shrink-0 rounded-full px-3 text-[12.5px] leading-8", sp.department === d.id ? "bg-surface font-medium shadow-sm" : "text-muted hover:bg-surface")}>
              {d.name}
            </Link>
          ))}
        </div>
      </div>
      {tasks.length === 0 ? (
        <Empty title="No tasks here yet">Assign an objective on the command center, trigger an agent manually, or run a workflow.</Empty>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {tasks.map((t) => (
              <li key={t.id}>
                <Link href={`/tasks/${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sunken/60 sm:px-5">
                  <span className={cx("grid size-8 shrink-0 place-items-center rounded-lg", t.status === "running" ? "bg-accent-soft text-accent-strong" : "bg-accent-softer text-ink-2")}>
                    <AgentIcon id={t.agentId} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium">{t.summary || t.title}</div>
                    <div className="truncate font-mono text-[10.5px] text-muted">
                      {name.get(t.agentId)} · {t.createdBy} · {timeAgo(t.createdAt)}
                      {t.error && t.status !== "completed" && <span className="text-bad"> · {t.error.slice(0, 80)}</span>}
                    </div>
                  </div>
                  <div className="hidden text-right font-mono text-[11px] text-muted sm:block">
                    <div>{duration(t.durationMs)}</div>
                    <div>{usd(t.costUsd)}</div>
                  </div>
                  <StatusBadge status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
