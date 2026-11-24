import { PgBoss } from "pg-boss";

export const QUEUES = {
  agentTask: "agent-task",
  workflowAdvance: "workflow-advance",
  workflowCron: "workflow-cron",
  approvalExecute: "approval-execute",
  briefing: "briefing",
  publishDue: "publish-due",
  metricsRefresh: "metrics-refresh",
  delayedStep: "workflow-delay",
} as const;

const g = globalThis as unknown as { __boss?: Promise<PgBoss> };

/** Producer-side singleton (Next.js server + worker). Workers subscribe in src/worker. */
export function getBoss(): Promise<PgBoss> {
  if (!g.__boss) {
    g.__boss = (async () => {
      const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, schema: "pgboss" });
      boss.on("error", (e) => console.error("[pg-boss]", e));
      await boss.start();
      for (const name of Object.values(QUEUES)) {
        await boss.createQueue(name, { expireInSeconds: 3600 }).catch(() => {});
      }
      return boss;
    })().catch((e) => {
      g.__boss = undefined;
      throw e;
    });
  }
  return g.__boss;
}

export async function enqueueTask(taskId: string, opts: { priority?: number; startAfter?: Date } = {}) {
  const boss = await getBoss();
  await boss.send(
    QUEUES.agentTask,
    { taskId },
    {
      // pg-boss priority: higher runs first. Our priority: 1 = highest.
      priority: 10 - (opts.priority ?? 5),
      // Business-level retries are handled by the runner (tasks.attempts);
      // pg-boss only re-delivers if a worker crashes mid-job.
      retryLimit: 1,
      retryDelay: 30,
      startAfter: opts.startAfter,
    },
  );
}
