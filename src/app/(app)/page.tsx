import Link from "next/link";
import { db, schema } from "@/db";
import { asc, desc, eq, gte, inArray, sql, and } from "drizzle-orm";
import { DEPARTMENTS } from "@/server/agents/catalog";
import { LoopMap } from "@/components/loop-map";
import { ActivityFeed } from "@/components/activity-feed";
import { ObjectiveComposer } from "@/components/objective-composer";
import { Card, cx, LinkButton, SectionTitle, StatusBadge } from "@/components/ui";
import { systemHealth, startOfToday } from "@/server/health";
import { ApprovalQuick } from "@/components/approval-quick";
import { timeAgo } from "@/lib/format";

export default async function CommandCenter() {
  const agents = await db.select().from(schema.agents).orderBy(asc(schema.agents.sortOrder));
  const running = await db.select({ id: schema.tasks.id, agentId: schema.tasks.agentId, title: schema.tasks.title }).from(schema.tasks).where(eq(schema.tasks.status, "running"));
  const today = await startOfToday();
  const [t] = await db
    .select({
      completed: sql<number>`count(*) filter (where status = 'completed' and completed_at >= ${today.toISOString()})`,
      failed: sql<number>`count(*) filter (where status = 'failed' and completed_at >= ${today.toISOString()})`,
      queued: sql<number>`count(*) filter (where status in ('queued','blocked'))`,
      cost: sql<number>`coalesce(sum(cost_usd) filter (where created_at >= ${today.toISOString()}),0)`,
    })
    .from(schema.tasks);
  const pending = await db.select().from(schema.approvals).where(eq(schema.approvals.status, "pending")).orderBy(desc(schema.approvals.createdAt));
  const events = await db.select().from(schema.events).orderBy(desc(schema.events.id)).limit(30);
  const health = await systemHealth();
  const recentRuns = await db
    .select({ id: schema.workflowRuns.id, status: schema.workflowRuns.status, startedAt: schema.workflowRuns.startedAt, name: schema.workflows.name, wid: schema.workflows.id })
    .from(schema.workflowRuns)
    .innerJoin(schema.workflows, eq(schema.workflows.id, schema.workflowRuns.workflowId))
    .where(and(gte(schema.workflowRuns.startedAt, new Date(Date.now() - 3 * 86400_000)), inArray(schema.workflowRuns.status, ["running", "waiting", "completed", "failed"])))
    .orderBy(desc(schema.workflowRuns.startedAt))
    .limit(4);

  const currentTitle = new Map(running.map((r) => [r.agentId, r.title]));
  const depts = DEPARTMENTS.map((d) => ({
    id: d.id,
    name: d.name,
    agents: agents.filter((a) => a.department === d.id).map((a) => ({ id: a.id, name: a.name, status: a.status, enabled: a.enabled, currentTask: currentTitle.get(a.id) ?? null })),
  }));
  const active = agents.filter((a) => a.status === "running").length;
  const attention = agents.filter((a) => a.status === "attention" && a.enabled).length;
  const disabled = agents.filter((a) => !a.enabled).length;
  const idle = agents.length - active - attention - disabled;

  const kpis = [
    { label: "Agents", value: agents.length, href: "/departments/research" },
    { label: "Active now", value: active, tone: active ? "accent" : undefined, href: "/tasks?status=running" },
    { label: "Idle", value: idle },
    { label: "Need attention", value: attention, tone: attention ? "bad" : undefined, href: "/tasks?status=failed" },
    { label: "Done today", value: Number(t.completed), href: "/tasks?status=completed" },
    { label: "Queued", value: Number(t.queued), href: "/tasks?status=queued" },
    { label: "Failed today", value: Number(t.failed), tone: Number(t.failed) ? "bad" : undefined, href: "/tasks?status=failed" },
  ] as const;

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between animate-rise">
        <h1 className="display text-[44px] sm:text-[60px] xl:text-[68px]">
          0 employees.
          <br />
          <span className="text-[#a9a9af]">{agents.length} AI agents.</span>
        </h1>
        <Card className="w-full p-4 lg:w-[340px]">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-muted">System health</span>
            <span className="font-mono text-[11px] text-muted">${Number(t.cost).toFixed(2)} spent today</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={cx("text-[28px] font-semibold tracking-tight tabular", health.score >= 85 ? "text-ok" : health.score >= 50 ? "text-warn" : "text-bad")}>{health.score}%</span>
            <span className="text-[13px] font-medium">{health.label}</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-sunken">
            <div className={cx("h-full rounded-full", health.score >= 85 ? "bg-ok" : health.score >= 50 ? "bg-warn" : "bg-bad")} style={{ width: `${health.score}%` }} />
          </div>
          {health.issues.length > 0 && (
            <ul className="mt-3 space-y-1">
              {health.issues.map((i) => (
                <li key={i} className="flex gap-2 text-[12px] text-ink-2">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-bad" />
                  {i}
                </li>
              ))}
            </ul>
          )}
          {!health.ai && (
            <LinkButton href="/integrations" size="sm" variant="primary" className="mt-3">
              Connect Anthropic
            </LinkButton>
          )}
        </Card>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {kpis.map((k) => {
          const inner = (
            <Card className="h-full px-4 py-3.5 transition-shadow hover:shadow-[var(--shadow-float)]">
              <div className="text-[12px] text-muted">{k.label}</div>
              <div className={cx("mt-1 text-[26px] font-semibold tracking-tight tabular", "tone" in k && k.tone === "bad" && "text-bad", "tone" in k && k.tone === "accent" && "text-accent-strong")}>{k.value}</div>
            </Card>
          );
          return "href" in k && k.href ? (
            <Link key={k.label} href={k.href}>
              {inner}
            </Link>
          ) : (
            <div key={k.label}>{inner}</div>
          );
        })}
      </section>

      <section className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          <LoopMap depts={depts} running={active} pending={pending.length} pendingTitles={pending.map((p) => p.title)} />
        </div>

        <div className="grid content-start gap-6 md:grid-cols-2 2xl:grid-cols-1">
          <div className="md:col-span-2 2xl:col-span-1">
          <ObjectiveComposer agents={agents.map((a) => ({ id: a.id, name: a.name, department: a.department }))} />
          </div>

          <Card className="p-4">
            <SectionTitle right={<Link href="/approvals" className="text-[12px] text-muted hover:text-ink">All approvals →</Link>}>Needs you</SectionTitle>
            {pending.length === 0 ? (
              <div className="py-3 text-[13px] text-muted">Nothing is waiting for your decision.</div>
            ) : (
              <ApprovalQuick items={pending.slice(0, 4).map((p) => ({ id: p.id, title: p.title, category: p.category, risk: p.risk }))} />
            )}
          </Card>

          <Card className="p-4">
            <SectionTitle right={<Link href="/workflows" className="text-[12px] text-muted hover:text-ink">Workflows →</Link>}>Recent runs</SectionTitle>
            {recentRuns.length === 0 ? (
              <div className="py-3 text-[13px] text-muted">No workflow runs in the last 3 days.</div>
            ) : (
              <ul className="space-y-1">
                {recentRuns.map((r) => (
                  <li key={r.id}>
                    <Link href={`/workflows/${r.wid}?run=${r.id}`} className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 hover:bg-sunken">
                      <span className="truncate text-[13px]">{r.name}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-[10.5px] text-muted">{timeAgo(r.startedAt)}</span>
                        <StatusBadge status={r.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </section>

      <section>
        <Card className="p-4 sm:p-5">
          <SectionTitle right={<span className="font-mono text-[11px] text-muted">real execution events</span>}>Live activity</SectionTitle>
          <div className="scroll-thin max-h-[560px] overflow-y-auto">
            <ActivityFeed initial={events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }))} limit={40} />
          </div>
        </Card>
      </section>
    </div>
  );
}
