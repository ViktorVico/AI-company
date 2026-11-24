/**
 * Background worker: executes agent tasks, advances workflows, fires schedules,
 * publishes due content, refreshes metrics and generates the morning briefing.
 * Run with `npm run worker` alongside the web app.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { getBoss, QUEUES } = await import("../server/queue");
  const { runTask } = await import("../server/agents/runner");
  const engine = await import("../server/workflows/engine");
  const { generateBriefing } = await import("../server/briefing");
  const { executeApproval } = await import("../server/approvals");
  const { queueDuePublishing } = await import("../server/publishing");
  const { refreshContentMetrics } = await import("../server/tools");
  const { syncSystemSchedules } = await import("../server/schedules");
  const { db, schema } = await import("../db");
  const { inArray, eq } = await import("drizzle-orm");
  const { enqueueTask } = await import("../server/queue");

  const boss = await getBoss();
  const concurrency = Number(process.env.WORKER_CONCURRENCY || 4);

  type J<T> = { data: T }[];
  await boss.work<{ taskId: string }>(QUEUES.agentTask, { localConcurrency: concurrency }, async (jobs: J<{ taskId: string }>) => {
    for (const j of jobs) await runTask(j.data.taskId);
  });
  await boss.work<{ workflowId: string }>(QUEUES.workflowCron, async (jobs: J<{ workflowId: string }>) => {
    for (const j of jobs) {
      const wf = await db.query.workflows.findFirst({ where: eq(schema.workflows.id, j.data.workflowId) });
      if (wf?.enabled) await engine.startRun(wf.id, "schedule");
    }
  });
  await boss.work<{ runId: string; nodeId: string }>(QUEUES.delayedStep, async (jobs: J<{ runId: string; nodeId: string }>) => {
    for (const j of jobs) await engine.onDelayElapsed(j.data.runId, j.data.nodeId);
  });
  await boss.work<{ approvalId: string }>(QUEUES.approvalExecute, async (jobs: J<{ approvalId: string }>) => {
    for (const j of jobs) await executeApproval(j.data.approvalId);
  });
  await boss.work(QUEUES.briefing, async () => {
    await generateBriefing({ deliver: true });
  });
  await boss.work(QUEUES.publishDue, async () => {
    await queueDuePublishing();
  });
  await boss.work(QUEUES.metricsRefresh, async () => {
    await refreshContentMetrics(14);
  });

  await engine.syncSchedules();
  await syncSystemSchedules();

  // Recover: tasks left "running" by a crashed worker go back to the queue; re-enqueue queued tasks.
  await db.update(schema.tasks).set({ status: "queued" }).where(eq(schema.tasks.status, "running"));
  await db.update(schema.agents).set({ status: "idle", currentTaskId: null }).where(eq(schema.agents.status, "running"));
  const queued = await db.select({ id: schema.tasks.id, priority: schema.tasks.priority }).from(schema.tasks).where(inArray(schema.tasks.status, ["queued"]));
  for (const t of queued) await enqueueTask(t.id, { priority: t.priority });

  const beat = async () => {
    await db
      .insert(schema.settings)
      .values({ key: "workerHeartbeat", value: { at: new Date().toISOString(), pid: process.pid } })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: { at: new Date().toISOString(), pid: process.pid }, updatedAt: new Date() } })
      .catch((e: Error) => console.error("heartbeat", e.message));
  };
  await beat();
  setInterval(beat, 30_000);

  console.log(`[worker] ready — concurrency ${concurrency}, ${queued.length} queued task(s) resumed`);

  const stop = async () => {
    console.log("[worker] shutting down…");
    await boss.stop({ graceful: true, timeout: 30_000 });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
