import { db, schema } from "@/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { WorkflowNode, WorkflowEdge } from "@/db/schema";
import { createTask } from "@/server/tasks";
import { createApproval } from "@/server/actions";
import { emit } from "@/server/lib/events";
import { getBoss, QUEUES } from "@/server/queue";
import { appTimezone } from "@/server/lib/settings";
import { CronExpressionParser } from "cron-parser";

type Upstream = { agent: string; title: string; summary: string; output: string; data?: Record<string, unknown> | null; status?: string };

const TERMINAL = ["completed", "skipped", "failed"];

function parseOut(s: string | null): Upstream[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function validateGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const errs: string[] = [];
  const ids = new Set(nodes.map((n) => n.id));
  if (nodes.filter((n) => n.type === "trigger").length !== 1) errs.push("A workflow needs exactly one trigger node.");
  for (const e of edges) if (!ids.has(e.source) || !ids.has(e.target)) errs.push(`Edge ${e.id} points to a missing node.`);
  for (const n of nodes) {
    if (n.type === "agent" && !n.data.agentId) errs.push(`Step “${n.data.label ?? n.id}” has no agent.`);
    if (n.type === "agent" && !n.data.instructions?.trim()) errs.push(`Step “${n.data.label ?? n.id}” has no instructions.`);
    if (n.type !== "trigger" && !edges.some((e) => e.target === n.id)) errs.push(`Step “${n.data.label ?? n.id}” is not connected.`);
  }
  // cycle detection
  const adj = new Map<string, string[]>();
  for (const e of edges) adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
  const state = new Map<string, number>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const t of adj.get(id) ?? []) if (visit(t)) return true;
    state.set(id, 2);
    return false;
  };
  if (nodes.some((n) => visit(n.id))) errs.push("Workflows cannot contain loops.");
  return errs;
}

export async function startRun(workflowId: string, trigger: string, input: Record<string, unknown> = {}) {
  const wf = await db.query.workflows.findFirst({ where: eq(schema.workflows.id, workflowId) });
  if (!wf) throw new Error("Workflow not found");
  const errs = validateGraph(wf.nodes, wf.edges);
  if (errs.length) throw new Error(errs.join(" "));
  const [run] = await db.insert(schema.workflowRuns).values({ workflowId, trigger, input }).returning();
  await db.insert(schema.workflowStepRuns).values(
    wf.nodes.map((n) => ({
      runId: run.id,
      nodeId: n.id,
      status: n.type === "trigger" ? "completed" : "pending",
      output: n.type === "trigger" && Object.keys(input).length ? JSON.stringify([{ agent: "Trigger", title: "Run input", summary: "", output: JSON.stringify(input) }]) : null,
      startedAt: n.type === "trigger" ? new Date() : null,
      completedAt: n.type === "trigger" ? new Date() : null,
    })),
  );
  await db.update(schema.workflows).set({ lastRunAt: new Date() }).where(eq(schema.workflows.id, workflowId));
  await emit("workflow.started", `Workflow “${wf.name}” started (${trigger})`, { data: { runId: run.id, workflowId } });
  await advance(run.id);
  return run.id;
}

/** Moves a run forward. Serialized per run with an advisory lock. */
export async function advance(runId: string) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${runId}))`);
    const run = await tx.query.workflowRuns.findFirst({ where: eq(schema.workflowRuns.id, runId) });
    if (!run || !["running", "waiting"].includes(run.status)) return;
    const wf = await tx.query.workflows.findFirst({ where: eq(schema.workflows.id, run.workflowId) });
    if (!wf) return;
    const nodes = new Map(wf.nodes.map((n) => [n.id, n]));

    for (let pass = 0; pass < wf.nodes.length + 1; pass++) {
      const steps = await tx.select().from(schema.workflowStepRuns).where(eq(schema.workflowStepRuns.runId, runId));
      const byNode = new Map(steps.map((s) => [s.nodeId, s]));
      let progressed = false;

      for (const step of steps.filter((s) => s.status === "pending")) {
        const node = nodes.get(step.nodeId);
        if (!node) continue;
        const incoming = wf.edges.filter((e) => e.target === node.id);
        const preds = incoming.map((e) => ({ e, s: byNode.get(e.source) }));
        if (preds.some((p) => !p.s || !TERMINAL.includes(p.s.status))) continue; // not ready
        const active = preds.filter(
          (p) => p.s!.status === "completed" && (nodes.get(p.e.source)?.type !== "condition" || (p.e.sourceHandle ?? "true") === p.s!.branch),
        );
        progressed = true;
        if (!active.length) {
          await tx.update(schema.workflowStepRuns).set({ status: "skipped", completedAt: new Date() }).where(eq(schema.workflowStepRuns.id, step.id));
          continue;
        }
        const upstream = active.flatMap((p) => parseOut(p.s!.output));
        const passOut = JSON.stringify(upstream);

        switch (node.type) {
          case "agent": {
            const agent = await tx.query.agents.findFirst({ where: eq(schema.agents.id, node.data.agentId!) });
            const taskId = await createTask({
              agentId: node.data.agentId!,
              title: `${wf.name}: ${node.data.label || agent?.role || "step"}`,
              instructions: node.data.instructions || "Do your standard job for this workflow.",
              createdBy: `workflow:${wf.id}`,
              workflowRunId: runId,
              workflowNodeId: node.id,
              context: { upstream, runInput: run.input },
              priority: 4,
            });
            await tx.update(schema.workflowStepRuns).set({ status: "running", taskId, startedAt: new Date() }).where(eq(schema.workflowStepRuns.id, step.id));
            break;
          }
          case "condition": {
            const last = upstream[upstream.length - 1];
            const text = upstream.map((u) => `${u.summary}\n${u.output}`).join("\n").toLowerCase();
            const val = (node.data.value ?? "").toLowerCase();
            let ok = false;
            switch (node.data.mode ?? "contains") {
              case "contains":
                ok = text.includes(val);
                break;
              case "not_contains":
                ok = !text.includes(val);
                break;
              case "data_gte":
              case "data_lte": {
                const raw = node.data.field ? (last?.data as Record<string, unknown> | undefined)?.[node.data.field] : undefined;
                const num = typeof raw === "number" ? raw : Array.isArray(raw) ? raw.length : Number(raw);
                ok = !isNaN(num) && (node.data.mode === "data_gte" ? num >= Number(node.data.value) : num <= Number(node.data.value));
                break;
              }
              case "status":
                ok = upstream.every((u) => (u.status ?? "completed") === (node.data.value || "completed"));
                break;
            }
            await tx
              .update(schema.workflowStepRuns)
              .set({ status: "completed", branch: ok ? "true" : "false", output: passOut, startedAt: new Date(), completedAt: new Date() })
              .where(eq(schema.workflowStepRuns.id, step.id));
            break;
          }
          case "approval": {
            const approvalId = await createApproval({
              category: "workflow_gate",
              title: node.data.title || `Continue “${wf.name}”?`,
              summary: upstream.length ? upstream.map((u) => `• ${u.agent}: ${u.summary}`).join("\n").slice(0, 1500) : "Approve to let the workflow continue.",
              payload: { workflowId: wf.id, runId },
              workflowRunId: runId,
              workflowNodeId: node.id,
              risk: "medium",
            });
            await tx.update(schema.workflowStepRuns).set({ status: "waiting", approvalId, output: passOut, startedAt: new Date() }).where(eq(schema.workflowStepRuns.id, step.id));
            break;
          }
          case "delay": {
            const minutes = Math.max(1, Number(node.data.minutes ?? 60));
            await tx.update(schema.workflowStepRuns).set({ status: "waiting", output: passOut, startedAt: new Date() }).where(eq(schema.workflowStepRuns.id, step.id));
            const boss = await getBoss();
            await boss.send(QUEUES.delayedStep, { runId, nodeId: node.id }, { startAfter: new Date(Date.now() + minutes * 60_000) });
            break;
          }
          default:
            await tx.update(schema.workflowStepRuns).set({ status: "completed", output: passOut, completedAt: new Date() }).where(eq(schema.workflowStepRuns.id, step.id));
        }
      }
      if (!progressed) break;
    }

    const steps = await tx.select().from(schema.workflowStepRuns).where(eq(schema.workflowStepRuns.runId, runId));
    const open = steps.filter((s) => !TERMINAL.includes(s.status));
    const failed = steps.filter((s) => s.status === "failed");
    if (!open.length) {
      const status = failed.length ? "failed" : "completed";
      await tx.update(schema.workflowRuns).set({ status, completedAt: new Date(), error: failed.length ? `${failed.length} step(s) failed` : null }).where(eq(schema.workflowRuns.id, runId));
      await emit(`workflow.${status}`, `Workflow “${wf.name}” ${status === "completed" ? "completed" : "finished with failures"}`, { data: { runId, workflowId: wf.id } });
    } else {
      const waiting = !open.some((s) => s.status === "running") && open.some((s) => s.status === "waiting");
      await tx.update(schema.workflowRuns).set({ status: waiting ? "waiting" : "running" }).where(eq(schema.workflowRuns.id, runId));
    }
  });
}

async function failRemaining(runId: string, reason: string) {
  await db
    .update(schema.workflowStepRuns)
    .set({ status: "skipped", completedAt: new Date() })
    .where(and(eq(schema.workflowStepRuns.runId, runId), inArray(schema.workflowStepRuns.status, ["pending", "waiting"])));
  await db.update(schema.workflowRuns).set({ status: "failed", error: reason, completedAt: new Date() }).where(eq(schema.workflowRuns.id, runId));
}

export async function onTaskFinished(taskId: string) {
  const task = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) });
  if (!task?.workflowRunId) return;
  // Look up by node (the step row exists from run start) so we never race the advance transaction.
  const step = await db.query.workflowStepRuns.findFirst({
    where: and(eq(schema.workflowStepRuns.runId, task.workflowRunId), eq(schema.workflowStepRuns.nodeId, task.workflowNodeId ?? "")),
  });
  if (!step || TERMINAL.includes(step.status)) return;
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, task.agentId), columns: { name: true } });
  if (task.status === "completed") {
    const out: Upstream[] = [{ agent: agent?.name ?? task.agentId, title: task.title, summary: task.summary ?? "", output: task.output ?? "", data: task.data, status: "completed" }];
    await db.update(schema.workflowStepRuns).set({ status: "completed", taskId, output: JSON.stringify(out), completedAt: new Date() }).where(eq(schema.workflowStepRuns.id, step.id));
    await advance(task.workflowRunId);
  } else {
    await db.update(schema.workflowStepRuns).set({ status: "failed", error: task.error, completedAt: new Date() }).where(eq(schema.workflowStepRuns.id, step.id));
    await failRemaining(task.workflowRunId, `Step “${task.title}” ${task.status}: ${task.error ?? ""}`);
    await emit("workflow.failed", `Workflow step “${task.title}” ${task.status} — run stopped`, { taskId, data: { runId: task.workflowRunId } });
  }
}

export async function onApprovalDecided(approvalId: string, approved: boolean) {
  const step = await db.query.workflowStepRuns.findFirst({ where: eq(schema.workflowStepRuns.approvalId, approvalId) });
  if (!step) return;
  if (approved) {
    await db.update(schema.workflowStepRuns).set({ status: "completed", completedAt: new Date() }).where(eq(schema.workflowStepRuns.id, step.id));
    await db.update(schema.workflowRuns).set({ status: "running" }).where(eq(schema.workflowRuns.id, step.runId));
    await advance(step.runId);
  } else {
    await db.update(schema.workflowStepRuns).set({ status: "failed", error: "Rejected by owner", completedAt: new Date() }).where(eq(schema.workflowStepRuns.id, step.id));
    await failRemaining(step.runId, "Rejected at approval gate");
  }
}

export async function onDelayElapsed(runId: string, nodeId: string) {
  await db
    .update(schema.workflowStepRuns)
    .set({ status: "completed", completedAt: new Date() })
    .where(and(eq(schema.workflowStepRuns.runId, runId), eq(schema.workflowStepRuns.nodeId, nodeId), eq(schema.workflowStepRuns.status, "waiting")));
  await db.update(schema.workflowRuns).set({ status: "running" }).where(and(eq(schema.workflowRuns.id, runId), eq(schema.workflowRuns.status, "waiting")));
  await advance(runId);
}

export async function cancelRun(runId: string) {
  const steps = await db.select().from(schema.workflowStepRuns).where(eq(schema.workflowStepRuns.runId, runId));
  const taskIds = steps.map((s) => s.taskId).filter(Boolean) as string[];
  if (taskIds.length)
    await db.update(schema.tasks).set({ status: "cancelled", completedAt: new Date() }).where(and(inArray(schema.tasks.id, taskIds), inArray(schema.tasks.status, ["queued", "blocked"])));
  await db
    .update(schema.workflowStepRuns)
    .set({ status: "skipped", completedAt: new Date() })
    .where(and(eq(schema.workflowStepRuns.runId, runId), inArray(schema.workflowStepRuns.status, ["pending", "waiting", "running"])));
  await db.update(schema.workflowRuns).set({ status: "cancelled", completedAt: new Date() }).where(eq(schema.workflowRuns.id, runId));
}

/** Registers cron schedules in pg-boss for every enabled scheduled workflow. */
export async function syncSchedules() {
  const boss = await getBoss();
  const all = await db.select().from(schema.workflows);
  const tz = appTimezone();
  for (const wf of all) {
    const wanted = wf.enabled && wf.triggerType === "schedule" && wf.schedule;
    if (wanted) {
      try {
        CronExpressionParser.parse(wf.schedule!, { tz });
        await boss.schedule(QUEUES.workflowCron, wf.schedule!, { workflowId: wf.id }, { tz, key: wf.id });
      } catch (e) {
        console.error(`Invalid schedule for workflow ${wf.name}:`, (e as Error).message);
      }
    } else {
      await boss.unschedule(QUEUES.workflowCron, wf.id).catch(() => {});
    }
  }
}

export function nextRuns(cron: string, count = 3): Date[] {
  try {
    const it = CronExpressionParser.parse(cron, { tz: appTimezone() });
    return Array.from({ length: count }, () => it.next().toDate());
  } catch {
    return [];
  }
}

/** Event triggers: start workflows listening to this event type. */
export async function handleEvent(type: string, data: unknown) {
  const listeners = await db
    .select({ id: schema.workflows.id })
    .from(schema.workflows)
    .where(and(eq(schema.workflows.enabled, true), eq(schema.workflows.triggerType, "event"), eq(schema.workflows.eventType, type)));
  if (!listeners.length) return;
  const d = (data ?? {}) as { runId?: string };
  for (const l of listeners) {
    // Never let a workflow re-trigger itself from its own completion.
    if (d.runId) {
      const r = await db.query.workflowRuns.findFirst({ where: eq(schema.workflowRuns.id, d.runId) });
      if (r?.workflowId === l.id) continue;
    }
    await startRun(l.id, `event:${type}`, { event: type, data: d as Record<string, unknown> });
  }
}
