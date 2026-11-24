import Link from "next/link";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { DEPARTMENTS } from "@/server/agents/catalog";
import { agentStats } from "@/server/metrics";
import { AgentIcon } from "@/components/agent-icon";
import { ActivityFeed } from "@/components/activity-feed";
import { ObjectiveComposer } from "@/components/objective-composer";
import { Badge, Card, cx, PageHeader, SectionTitle, Stat, StatusBadge, StatusDot } from "@/components/ui";
import { duration, pct, timeAgo, usd } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: DEPARTMENTS.find((d) => d.id === id)?.name ?? "Department" };
}

export default async function DepartmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dept = DEPARTMENTS.find((d) => d.id === id);
  if (!dept) notFound();
  const agents = await db.select().from(schema.agents).where(eq(schema.agents.department, id)).orderBy(asc(schema.agents.sortOrder));
  const ids = agents.map((a) => a.id);
  const stats = await agentStats(30);
  const tasks = await db.select().from(schema.tasks).where(inArray(schema.tasks.agentId, ids)).orderBy(desc(schema.tasks.createdAt)).limit(15);
  const events = await db.select().from(schema.events).where(inArray(schema.events.agentId, ids)).orderBy(desc(schema.events.id)).limit(25);
  const running = await db.select().from(schema.tasks).where(eq(schema.tasks.status, "running"));
  const tot = ids.reduce(
    (s, a) => {
      const x = stats[a];
      if (!x) return s;
      return { total: s.total + x.total, completed: s.completed + x.completed, failed: s.failed + x.failed, cost: s.cost + x.costUsd };
    },
    { total: 0, completed: 0, failed: 0, cost: 0 },
  );
  const name = new Map(agents.map((a) => [a.id, a.name]));

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Link href="/" className="hover:text-ink">
              Command center
            </Link>
            <span>/</span>
            <span>Department</span>
          </>
        }
        title={
          <>
            {dept.name}. <span className="text-[#a9a9af]">{dept.tagline}.</span>
          </>
        }
        subtitle={dept.description}
      />

      <Card className="mb-6 grid grid-cols-2 gap-6 p-5 sm:grid-cols-4">
        <Stat label="Tasks (30 days)" value={tot.total} />
        <Stat label="Success rate" value={tot.completed + tot.failed ? pct(tot.completed / (tot.completed + tot.failed)) : "—"} />
        <Stat label="Working now" value={agents.filter((a) => a.status === "running").length} tone="accent" />
        <Stat label="AI cost (30 days)" value={usd(tot.cost)} />
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => {
          const s = stats[a.id];
          const cur = running.find((t) => t.agentId === a.id);
          return (
            <Link key={a.id} href={`/agents/${a.id}`} className="card group flex flex-col p-4 transition-shadow hover:shadow-[var(--shadow-float)] animate-rise">
              <div className="flex items-start justify-between gap-3">
                <span className={cx("grid size-9 place-items-center rounded-xl", a.status === "running" ? "bg-accent-soft text-accent-strong" : "bg-accent-softer text-ink-2")}>
                  <AgentIcon id={a.id} className="size-4" />
                </span>
                <span className="flex items-center gap-1.5">
                  <StatusDot status={a.enabled ? a.status : "disabled"} />
                  <span className="font-mono text-[10.5px] text-muted">{a.enabled ? a.status : "deactivated"}</span>
                </span>
              </div>
              <div className="mt-3 text-[15px] font-semibold tracking-tight">{a.name}</div>
              <div className="text-[12px] text-muted">{a.role}</div>
              <p className="mt-2 line-clamp-2 text-[12.5px] text-ink-2">{a.description}</p>
              {cur && <div className="mt-2 truncate rounded-lg bg-accent-softer px-2 py-1 font-mono text-[11px] text-accent-strong">→ {cur.title}</div>}
              <div className="mt-auto grid grid-cols-3 gap-2 border-t border-line pt-3 text-[11.5px]">
                <div>
                  <div className="text-muted">Success</div>
                  <div className="font-medium tabular">{pct(s?.successRate)}</div>
                </div>
                <div>
                  <div className="text-muted">Avg time</div>
                  <div className="font-medium tabular">{duration(s?.avgDurationMs)}</div>
                </div>
                <div>
                  <div className="text-muted">Tasks</div>
                  <div className="font-medium tabular">{s?.total ?? 0}</div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          <ObjectiveComposer title={`Assign work to ${dept.name}`} direct agents={agents.map((a) => ({ id: a.id, name: a.name, department: a.department }))} />
          <Card className="p-4">
            <SectionTitle right={<Link href={`/tasks?department=${id}`} className="text-[12px] text-muted hover:text-ink">All tasks →</Link>}>Recent tasks</SectionTitle>
            {tasks.length === 0 ? (
              <div className="py-4 text-[13px] text-muted">No tasks yet for this department.</div>
            ) : (
              <ul className="divide-y divide-line">
                {tasks.map((t) => (
                  <li key={t.id}>
                    <Link href={`/tasks/${t.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                      <AgentIcon id={t.agentId} className="size-3.5 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium">{t.summary || t.title}</div>
                        <div className="font-mono text-[10.5px] text-muted">
                          {name.get(t.agentId)} · {timeAgo(t.createdAt)}
                          {t.qualityScore != null && ` · QC ${t.qualityScore}`}
                        </div>
                      </div>
                      <StatusBadge status={t.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card className="p-4">
          <SectionTitle right={<Badge>{dept.name}</Badge>}>Activity</SectionTitle>
          <ActivityFeed agentIds={ids} initial={events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }))} />
        </Card>
      </div>
    </div>
  );
}
