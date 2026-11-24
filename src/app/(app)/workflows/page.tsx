import Link from "next/link";
import { db, schema } from "@/db";
import { desc, eq, sql } from "drizzle-orm";
import { nextRuns } from "@/server/workflows/engine";
import { appTimezone } from "@/server/lib/settings";
import { AgentIcon } from "@/components/agent-icon";
import { Badge, Card, Empty, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { runWorkflowNow, setWorkflowEnabled } from "@/app/actions";
import { describeCron } from "@/lib/cron";
import { dateTime, timeAgo } from "@/lib/format";

export const metadata = { title: "Workflows" };

export default async function WorkflowsPage() {
  const wfs = await db.select().from(schema.workflows).orderBy(desc(schema.workflows.enabled), schema.workflows.name);
  const last = await db
    .select({ workflowId: schema.workflowRuns.workflowId, status: schema.workflowRuns.status, startedAt: schema.workflowRuns.startedAt, n: sql<number>`count(*) over (partition by ${schema.workflowRuns.workflowId})` })
    .from(schema.workflowRuns)
    .orderBy(desc(schema.workflowRuns.startedAt));
  const lastBy = new Map<string, (typeof last)[number]>();
  for (const r of last) if (!lastBy.has(r.workflowId)) lastBy.set(r.workflowId, r);
  const tz = appTimezone();
  void eq;

  return (
    <div>
      <PageHeader
        title="Workflows"
        subtitle="Autonomous routines. Connect agents, add conditions and approval gates, set a schedule or an event trigger — the worker runs them for real."
        actions={
          <LinkButton href="/workflows/new" variant="primary">
            New workflow
          </LinkButton>
        }
      />
      {wfs.length === 0 ? (
        <Empty title="No workflows yet" action={<LinkButton href="/workflows/new" variant="primary">Create your first workflow</LinkButton>}>
          Run <code className="font-mono">npm run db:seed</code> to install the default workflows.
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {wfs.map((w) => {
            const r = lastBy.get(w.id);
            const agentNodes = w.nodes.filter((n) => n.type === "agent");
            const next = w.enabled && w.triggerType === "schedule" && w.schedule ? nextRuns(w.schedule, 1)[0] : null;
            return (
              <Card key={w.id} className="flex flex-col p-5 animate-rise">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/workflows/${w.id}`} className="min-w-0">
                    <h3 className="truncate text-[16px] font-semibold tracking-tight hover:underline underline-offset-4">{w.name}</h3>
                  </Link>
                  {w.enabled ? <Badge tone="ok">active</Badge> : <Badge>paused</Badge>}
                </div>
                <p className="mt-1 line-clamp-2 text-[12.5px] text-muted">{w.description}</p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {agentNodes.slice(0, 10).map((n) => (
                    <span key={n.id} title={n.data.label} className="grid size-6 place-items-center rounded-md bg-accent-softer text-ink-2">
                      <AgentIcon id={n.data.agentId ?? ""} className="size-3" />
                    </span>
                  ))}
                  {agentNodes.length > 10 && <span className="px-1 text-[11px] text-muted">+{agentNodes.length - 10}</span>}
                  {w.nodes.some((n) => n.type === "approval") && <Badge tone="dark">You</Badge>}
                </div>
                <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-[12px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Trigger</dt>
                    <dd className="text-right">{w.triggerType === "schedule" ? describeCron(w.schedule ?? "") : w.triggerType === "event" ? `on ${w.eventType}` : "manual"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Next run</dt>
                    <dd className="font-mono text-[11px]">{next ? `${dateTime(next, tz)} (${timeAgo(next)})` : "—"}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted">Last run</dt>
                    <dd className="flex items-center gap-2">
                      {r ? (
                        <>
                          <span className="font-mono text-[11px] text-muted">{timeAgo(r.startedAt)}</span>
                          <StatusBadge status={r.status} />
                        </>
                      ) : (
                        "never"
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <ActionButton size="sm" variant={w.enabled ? "secondary" : "primary"} fn={setWorkflowEnabled} args={[w.id, !w.enabled]}>
                    {w.enabled ? "Pause" : "Enable"}
                  </ActionButton>
                  <ActionButton size="sm" variant="outline" fn={runWorkflowNow} args={[w.id]}>
                    Run now
                  </ActionButton>
                  <LinkButton size="sm" variant="ghost" href={`/workflows/${w.id}`}>
                    Open builder →
                  </LinkButton>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
