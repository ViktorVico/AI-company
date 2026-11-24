import { db, schema } from "@/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { enqueueTask } from "@/server/queue";
import { emit } from "@/server/lib/events";

export async function createTask(v: {
  agentId: string;
  title: string;
  instructions: string;
  priority?: number;
  dependsOn?: string[];
  createdBy?: string;
  parentTaskId?: string | null;
  workflowRunId?: string | null;
  workflowNodeId?: string | null;
  context?: Record<string, unknown>;
}): Promise<string> {
  const deps = (v.dependsOn ?? []).filter(Boolean);
  let blocked = false;
  if (deps.length) {
    const rows = await db.select({ id: schema.tasks.id, status: schema.tasks.status }).from(schema.tasks).where(inArray(schema.tasks.id, deps));
    blocked = rows.some((r) => r.status !== "completed");
  }
  const [t] = await db
    .insert(schema.tasks)
    .values({
      agentId: v.agentId,
      title: v.title.slice(0, 300),
      instructions: v.instructions,
      priority: v.priority ?? 5,
      dependsOn: deps,
      createdBy: v.createdBy ?? "owner",
      parentTaskId: v.parentTaskId ?? null,
      workflowRunId: v.workflowRunId ?? null,
      workflowNodeId: v.workflowNodeId ?? null,
      context: v.context ?? {},
      status: blocked ? "blocked" : "queued",
    })
    .returning({ id: schema.tasks.id });
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, v.agentId), columns: { name: true } });
  await emit("task.created", `${agent?.name ?? v.agentId} was assigned “${v.title}”${blocked ? " (waiting on dependencies)" : ""}`, {
    agentId: v.agentId,
    taskId: t.id,
    data: { createdBy: v.createdBy },
  });
  if (!blocked) await enqueueTask(t.id, { priority: v.priority });
  return t.id;
}

/** Called after a task completes: release tasks whose dependencies are now all complete. */
export async function releaseDependents(taskId: string) {
  const waiting = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.status, "blocked"), sql`${schema.tasks.dependsOn} @> ${JSON.stringify([taskId])}::jsonb`));
  for (const t of waiting) {
    const deps = await db.select({ status: schema.tasks.status }).from(schema.tasks).where(inArray(schema.tasks.id, t.dependsOn));
    if (deps.every((d) => d.status === "completed")) {
      const [u] = await db
        .update(schema.tasks)
        .set({ status: "queued" })
        .where(and(eq(schema.tasks.id, t.id), eq(schema.tasks.status, "blocked")))
        .returning({ id: schema.tasks.id });
      if (u) await enqueueTask(t.id, { priority: t.priority });
    }
  }
}

/** A dependency failed: dependents can never run. */
export async function failDependents(taskId: string) {
  const waiting = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.status, "blocked"), sql`${schema.tasks.dependsOn} @> ${JSON.stringify([taskId])}::jsonb`));
  for (const t of waiting) {
    await db.update(schema.tasks).set({ status: "failed", error: `Dependency ${taskId} failed`, completedAt: new Date() }).where(eq(schema.tasks.id, t.id));
    await failDependents(t.id);
  }
}
