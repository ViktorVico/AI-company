import Link from "next/link";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { asc, eq } from "drizzle-orm";
import { AgentIcon } from "@/components/agent-icon";
import { Card, cx, PageHeader, SectionTitle, StatusBadge, Badge } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { ActionButton } from "@/components/action-button";
import { cancelTask, retryTask } from "@/app/actions";
import { compact, dateTime, duration, timeAgo, usd } from "@/lib/format";

export const metadata = { title: "Task" };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, id) });
  if (!t) notFound();
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, t.agentId) });
  const logs = await db.select().from(schema.taskLogs).where(eq(schema.taskLogs.taskId, id)).orderBy(asc(schema.taskLogs.id));
  const children = await db.select().from(schema.tasks).where(eq(schema.tasks.parentTaskId, id)).orderBy(asc(schema.tasks.createdAt));
  const parent = t.parentTaskId ? await db.query.tasks.findFirst({ where: eq(schema.tasks.id, t.parentTaskId), columns: { id: true, title: true } }) : null;
  const run = t.workflowRunId ? await db.query.workflowRuns.findFirst({ where: eq(schema.workflowRuns.id, t.workflowRunId) }) : null;
  const content = await db.select({ id: schema.contentItems.id, title: schema.contentItems.title, platform: schema.contentItems.platform, status: schema.contentItems.status }).from(schema.contentItems).where(eq(schema.contentItems.taskId, id));

  const meta: [string, React.ReactNode][] = [
    ["Agent", <Link key="a" className="underline-offset-2 hover:underline" href={`/agents/${t.agentId}`}>{agent?.name}</Link>],
    ["Requested by", <span key="c" className="font-mono text-[12px]">{t.createdBy}</span>],
    ["Created", dateTime(t.createdAt)],
    ["Duration", duration(t.durationMs)],
    ["Attempts", `${t.attempts} / ${t.maxAttempts}`],
    ["Model", <span key="m" className="font-mono text-[12px]">{t.model ?? agent?.model}</span>],
    ["Tokens", `${compact(t.inputTokens)} in · ${compact(t.outputTokens)} out`],
    ["Cost", usd(t.costUsd)],
    ["Quality", t.qualityScore != null ? `${t.qualityScore}/100` : "not reviewed"],
  ];

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Link href="/tasks" className="hover:text-ink">
              Tasks
            </Link>
            <span>/</span>
            <span className="font-mono">{t.id.slice(0, 8)}</span>
          </>
        }
        title={<span className="text-[28px] sm:text-[34px]">{t.title}</span>}
        subtitle={t.summary ?? undefined}
        actions={
          <>
            <StatusBadge status={t.status} />
            {["queued", "blocked", "running"].includes(t.status) && (
              <ActionButton variant="danger" size="sm" confirm="Cancel this task?" fn={cancelTask} args={[t.id]}>
                Cancel
              </ActionButton>
            )}
            {["failed", "cancelled"].includes(t.status) && (
              <ActionButton variant="primary" size="sm" fn={retryTask} args={[t.id]}>
                Retry
              </ActionButton>
            )}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          {t.error && t.status !== "completed" && (
            <Card className="border border-bad/20 bg-bad-soft p-4 text-[13px] text-bad">
              <div className="font-medium">{t.status === "queued" ? "Last attempt failed — retrying" : "Error"}</div>
              <div className="mt-1 whitespace-pre-wrap">{t.error}</div>
            </Card>
          )}
          <Card className="p-5">
            <SectionTitle>Output</SectionTitle>
            {t.output ? (
              <Markdown>{t.output}</Markdown>
            ) : (
              <div className="text-[13px] text-muted">{t.status === "running" ? "The agent is working — the output appears when it submits its result." : "No output."}</div>
            )}
          </Card>
          {t.data && Object.keys(t.data).length > 0 && (
            <Card className="p-5">
              <SectionTitle>Structured data</SectionTitle>
              <pre className="scroll-thin max-h-80 overflow-auto rounded-xl bg-sunken p-3 font-mono text-[11.5px]">{JSON.stringify(t.data, null, 2)}</pre>
            </Card>
          )}
          <Card className="p-5">
            <SectionTitle right={<span className="font-mono text-[11px] text-muted">{logs.length} entries</span>}>Execution trace</SectionTitle>
            {logs.length === 0 ? (
              <div className="text-[13px] text-muted">No trace yet.</div>
            ) : (
              <ol className="relative space-y-2 border-l border-line pl-4">
                {logs.map((l) => (
                  <li key={l.id} className="relative">
                    <span className={cx("absolute -left-[21px] top-1.5 size-2 rounded-full ring-4 ring-white", l.level === "error" ? "bg-bad" : l.level === "warn" ? "bg-warn" : l.kind === "tool_call" ? "bg-accent" : l.kind === "tool_result" ? "bg-ok" : "bg-line-2")} />
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[10.5px] text-muted">{new Date(l.createdAt).toLocaleTimeString()}</span>
                      <span className="font-mono text-[10.5px] text-faint">{l.kind}</span>
                    </div>
                    <div className={cx("whitespace-pre-wrap break-words text-[12.5px]", l.kind === "model" && l.level === "info" ? "text-ink-2" : "font-mono text-[11.5px]", l.level === "error" && "text-bad")}>{l.message}</div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-accent-softer">
                <AgentIcon id={t.agentId} className="size-4" />
              </span>
              <div>
                <div className="text-[14px] font-semibold">{agent?.name}</div>
                <div className="text-[12px] text-muted">{agent?.role}</div>
              </div>
            </div>
            <dl className="space-y-2 text-[13px]">
              {meta.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card className="p-5">
            <SectionTitle>Instructions</SectionTitle>
            <div className="scroll-thin max-h-72 overflow-y-auto whitespace-pre-wrap text-[12.5px] text-ink-2">{t.instructions}</div>
          </Card>
          {(parent || run || t.dependsOn.length > 0) && (
            <Card className="space-y-2 p-5 text-[13px]">
              <SectionTitle>Lineage</SectionTitle>
              {parent && (
                <div>
                  Parent:{" "}
                  <Link className="underline" href={`/tasks/${parent.id}`}>
                    {parent.title}
                  </Link>
                </div>
              )}
              {run && (
                <div>
                  Workflow run:{" "}
                  <Link className="underline" href={`/workflows/${run.workflowId}?run=${run.id}`}>
                    {run.id.slice(0, 8)}
                  </Link>{" "}
                  <StatusBadge status={run.status} />
                </div>
              )}
              {t.dependsOn.length > 0 && (
                <div>
                  Depends on:{" "}
                  {t.dependsOn.map((d) => (
                    <Link key={d} className="mr-2 font-mono text-[12px] underline" href={`/tasks/${d}`}>
                      {d.slice(0, 8)}
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          )}
          {children.length > 0 && (
            <Card className="p-5">
              <SectionTitle right={<Badge>{children.length}</Badge>}>Delegated tasks</SectionTitle>
              <ul className="space-y-1">
                {children.map((c) => (
                  <li key={c.id}>
                    <Link href={`/tasks/${c.id}`} className="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-sunken">
                      <AgentIcon id={c.agentId} className="size-3.5 text-muted" />
                      <span className="flex-1 truncate text-[12.5px]">{c.title}</span>
                      <StatusBadge status={c.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {content.length > 0 && (
            <Card className="p-5">
              <SectionTitle>Content created</SectionTitle>
              <ul className="space-y-1">
                {content.map((c) => (
                  <li key={c.id}>
                    <Link href={`/content/${c.id}`} className="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-sunken">
                      <span className="font-mono text-[10.5px] text-muted">{c.platform}</span>
                      <span className="flex-1 truncate text-[12.5px]">{c.title}</span>
                      <StatusBadge status={c.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <div className="px-1 font-mono text-[10.5px] text-muted">updated {timeAgo(t.completedAt ?? t.startedAt ?? t.createdAt)}</div>
        </div>
      </div>
    </div>
  );
}
