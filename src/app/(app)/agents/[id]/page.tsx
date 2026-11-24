import Link from "next/link";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { and, desc, eq, or } from "drizzle-orm";
import { DEPARTMENTS, MODEL_OPTIONS, ALL_PERMISSIONS } from "@/server/agents/catalog";
import { agentStats } from "@/server/metrics";
import { TOOL_DESCRIPTIONS } from "@/server/tools";
import { AgentIcon } from "@/components/agent-icon";
import { Card, cx, PageHeader, SectionTitle, Stat, StatusBadge, StatusDot, Badge } from "@/components/ui";
import { AgentToggle, AgentConfig, RunTaskForm, MemoryPanel, Tabs } from "./client";
import { compact, duration, pct, timeAgo, usd, dateTime } from "@/lib/format";
import { Markdown } from "@/components/markdown";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await db.query.agents.findFirst({ where: eq(schema.agents.id, id), columns: { name: true } });
  return { title: a?.name ?? "Agent" };
}

export default async function AgentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab = "overview" } = await searchParams;
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, id) });
  if (!agent) notFound();
  const dept = DEPARTMENTS.find((d) => d.id === agent.department)!;
  const stats = (await agentStats(30))[id];
  const allTime = (await agentStats(3650))[id];
  const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.agentId, id)).orderBy(desc(schema.tasks.createdAt)).limit(40);
  const current = agent.currentTaskId ? await db.query.tasks.findFirst({ where: eq(schema.tasks.id, agent.currentTaskId) }) : null;
  const lastDone = tasks.find((t) => t.status === "completed");
  const logTask = current ?? tasks[0];
  const logs = logTask ? await db.select().from(schema.taskLogs).where(eq(schema.taskLogs.taskId, logTask.id)).orderBy(desc(schema.taskLogs.id)).limit(80) : [];
  const memories = await db.select().from(schema.memories).where(and(eq(schema.memories.scope, "agent"), eq(schema.memories.agentId, id))).orderBy(desc(schema.memories.createdAt)).limit(50);
  const messages = await db
    .select()
    .from(schema.agentMessages)
    .where(or(eq(schema.agentMessages.toAgent, id), eq(schema.agentMessages.fromAgent, id)))
    .orderBy(desc(schema.agentMessages.id))
    .limit(20);

  const TABS = [
    { id: "overview", label: "Overview" },
    { id: "config", label: "Prompt & model" },
    { id: "tools", label: "Tools & permissions" },
    { id: "memory", label: `Memory · ${memories.length}` },
    { id: "history", label: `Task history · ${allTime?.total ?? 0}` },
    { id: "logs", label: "Execution log" },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Link href={`/departments/${dept.id}`} className="hover:text-ink">
              {dept.name}
            </Link>
            <span>/</span>
            <span>{agent.role}</span>
          </>
        }
        title={
          <span className="flex items-center gap-4">
            <span className={cx("grid size-12 shrink-0 place-items-center rounded-2xl", agent.status === "running" ? "bg-accent-soft text-accent-strong" : "bg-surface text-ink shadow-[var(--shadow-card)]")}>
              <AgentIcon id={agent.id} className="size-5" />
            </span>
            {agent.name}
          </span>
        }
        subtitle={agent.description}
        actions={<AgentToggle id={agent.id} enabled={agent.enabled} />}
      />

      <Card className="mb-6 grid grid-cols-2 gap-6 p-5 sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <div className="text-[12px] text-muted">Status</div>
          <div className="mt-2 flex items-center gap-2">
            <StatusDot status={agent.enabled ? agent.status : "disabled"} />
            <span className="text-[15px] font-semibold capitalize">{agent.enabled ? agent.status : "deactivated"}</span>
          </div>
          <div className="mt-1 font-mono text-[10.5px] text-muted">{MODEL_OPTIONS.find((m) => m.id === agent.model)?.label ?? agent.model} · {agent.effort}</div>
        </div>
        <Stat label="Success rate · 30d" value={pct(stats?.successRate)} hint={`${stats?.completed ?? 0} done · ${stats?.failed ?? 0} failed`} />
        <Stat label="Avg execution" value={duration(stats?.avgDurationMs)} />
        <Stat label="Tokens · 30d" value={compact(stats?.tokens ?? 0)} />
        <Stat label="Cost · 30d" value={usd(stats?.costUsd ?? 0)} hint={`all-time ${usd(allTime?.costUsd ?? 0)}`} />
        <Stat label="Avg quality" value={stats?.avgQuality ?? "—"} hint="Quality Controller score" />
      </Card>

      <Tabs tabs={TABS} active={tab} />

      {tab === "overview" && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            <Card className="p-5">
              <SectionTitle>Current task</SectionTitle>
              {current ? (
                <Link href={`/tasks/${current.id}`} className="block rounded-xl bg-accent-softer p-3 hover:bg-accent-soft">
                  <div className="text-[14px] font-medium">{current.title}</div>
                  <div className="mt-1 font-mono text-[11px] text-accent-strong">running since {timeAgo(current.startedAt)} · attempt {current.attempts}</div>
                </Link>
              ) : (
                <div className="text-[13px] text-muted">{agent.enabled ? "Idle — waiting for work." : "Deactivated. Queued tasks will wait until you activate this agent."}</div>
              )}
            </Card>
            <RunTaskForm agentId={agent.id} agentName={agent.name} inputFormat={agent.inputFormat} disabled={!agent.enabled} />
            <Card className="p-5">
              <SectionTitle right={lastDone && <Link href={`/tasks/${lastDone.id}`} className="text-[12px] text-muted hover:text-ink">Open task →</Link>}>Latest output</SectionTitle>
              {lastDone?.output ? (
                <div className="max-h-[520px] overflow-y-auto scroll-thin">
                  <div className="mb-3 text-[13px] font-medium">{lastDone.summary}</div>
                  <Markdown>{lastDone.output}</Markdown>
                </div>
              ) : (
                <div className="text-[13px] text-muted">No completed output yet.</div>
              )}
            </Card>
          </div>
          <div className="space-y-6">
            <Card className="p-5">
              <SectionTitle>Contract</SectionTitle>
              <div className="space-y-3 text-[13px]">
                <div>
                  <div className="text-[12px] text-muted">Input</div>
                  <div className="mt-0.5">{agent.inputFormat}</div>
                </div>
                <div>
                  <div className="text-[12px] text-muted">Output</div>
                  <div className="mt-0.5">{agent.outputFormat}</div>
                </div>
              </div>
            </Card>
            <Card className="p-5">
              <SectionTitle>Agent messages</SectionTitle>
              {messages.length === 0 ? (
                <div className="text-[13px] text-muted">No messages exchanged yet.</div>
              ) : (
                <ul className="space-y-3">
                  {messages.map((m) => (
                    <li key={m.id} className="text-[12.5px]">
                      <div className="flex items-center justify-between gap-2 font-mono text-[10.5px] text-muted">
                        <span>
                          {m.fromAgent === id ? `→ ${m.toAgent}` : `← ${m.fromAgent}`} {m.toAgent === id && !m.readAt && <Badge tone="accent">unread</Badge>}
                        </span>
                        <span>{timeAgo(m.createdAt)}</span>
                      </div>
                      <div className="mt-0.5 font-medium">{m.subject}</div>
                      <div className="line-clamp-3 text-ink-2">{m.body}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === "config" && (
        <AgentConfig
          agent={{ id: agent.id, systemPrompt: agent.systemPrompt, inputFormat: agent.inputFormat, outputFormat: agent.outputFormat, model: agent.model, effort: agent.effort, maxIterations: agent.maxIterations, tools: agent.tools, permissions: agent.permissions }}
          models={MODEL_OPTIONS.map((m) => ({ id: m.id, label: `${m.label} — $${m.input}/$${m.output} per M tokens` }))}
          tools={Object.entries(TOOL_DESCRIPTIONS).map(([k, v]) => ({ id: k, description: v }))}
          permissions={ALL_PERMISSIONS}
          section="config"
        />
      )}
      {tab === "tools" && (
        <AgentConfig
          agent={{ id: agent.id, systemPrompt: agent.systemPrompt, inputFormat: agent.inputFormat, outputFormat: agent.outputFormat, model: agent.model, effort: agent.effort, maxIterations: agent.maxIterations, tools: agent.tools, permissions: agent.permissions }}
          models={[]}
          tools={Object.entries(TOOL_DESCRIPTIONS).map(([k, v]) => ({ id: k, description: v }))}
          permissions={ALL_PERMISSIONS}
          section="tools"
        />
      )}
      {tab === "memory" && <MemoryPanel agentId={agent.id} memories={memories.map((m) => ({ id: m.id, kind: m.kind, title: m.title, content: m.content, importance: m.importance, source: m.source, createdAt: m.createdAt.toISOString() }))} />}

      {tab === "history" && (
        <Card className="overflow-hidden">
          {tasks.length === 0 ? (
            <div className="p-6 text-[13px] text-muted">No tasks yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead className="text-left text-[11.5px] text-muted">
                  <tr className="border-b border-line">
                    <th className="px-5 py-3 font-medium">Task</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-3 py-3 font-medium">From</th>
                    <th className="px-3 py-3 font-medium text-right">Time</th>
                    <th className="px-3 py-3 font-medium text-right">Tokens</th>
                    <th className="px-3 py-3 font-medium text-right">Cost</th>
                    <th className="px-5 py-3 font-medium text-right">When</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.id} className="border-b border-line/60 last:border-0 hover:bg-sunken/60">
                      <td className="max-w-[360px] px-5 py-2.5">
                        <Link href={`/tasks/${t.id}`} className="block truncate font-medium hover:underline">
                          {t.title}
                        </Link>
                        {t.summary && <div className="truncate text-[12px] text-muted">{t.summary}</div>}
                      </td>
                      <td className="px-3">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="px-3 font-mono text-[11px] text-muted">{t.createdBy}</td>
                      <td className="px-3 text-right tabular">{duration(t.durationMs)}</td>
                      <td className="px-3 text-right tabular">{compact(t.inputTokens + t.outputTokens)}</td>
                      <td className="px-3 text-right tabular">{usd(t.costUsd)}</td>
                      <td className="px-5 text-right font-mono text-[11px] text-muted">{dateTime(t.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "logs" && (
        <Card className="p-5">
          <SectionTitle right={logTask && <Link href={`/tasks/${logTask.id}`} className="text-[12px] text-muted hover:text-ink">{logTask.title} →</Link>}>Execution log</SectionTitle>
          {logs.length === 0 ? (
            <div className="text-[13px] text-muted">No logs yet.</div>
          ) : (
            <ol className="space-y-1 font-mono text-[11.5px]">
              {logs.map((l) => (
                <li key={l.id} className={cx("flex gap-3 rounded-lg px-2 py-1", l.level === "error" && "bg-bad-soft text-bad", l.level === "warn" && "text-warn", l.kind === "tool_call" && "text-accent-strong")}>
                  <span className="shrink-0 text-muted">{new Date(l.createdAt).toLocaleTimeString()}</span>
                  <span className="whitespace-pre-wrap break-words">{l.message}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}
    </div>
  );
}
