import { db, schema, sql as pg } from "@/db";
import { sql } from "drizzle-orm";
import { eq, gte, and } from "drizzle-orm";
import { isConfigured } from "@/server/integrations/registry";
import { appTimezone } from "@/server/lib/settings";

export async function startOfToday(): Promise<Date> {
  const [r] = await pg`select (date_trunc('day', now() at time zone ${appTimezone()}) at time zone ${appTimezone()}) as d`;
  return new Date(r.d as string);
}

/** Real system health derived from worker heartbeat, intelligence connection, failure rate and agent state. */
export async function systemHealth() {
  const issues: string[] = [];
  const hb = await db.query.settings.findFirst({ where: eq(schema.settings.key, "workerHeartbeat") });
  const last = hb ? new Date((hb.value as { at: string }).at) : null;
  const workerUp = !!last && Date.now() - last.getTime() < 90_000;
  if (!workerUp) issues.push(last ? "Background worker stopped responding" : "Background worker has not started (run npm run worker)");
  const ai = await isConfigured("anthropic");
  if (!ai) issues.push("Anthropic is not connected — agents cannot think");
  const since = new Date(Date.now() - 24 * 3600_000);
  const [t] = await db
    .select({ done: sql<number>`count(*) filter (where status = 'completed')`, failed: sql<number>`count(*) filter (where status = 'failed')` })
    .from(schema.tasks)
    .where(gte(schema.tasks.createdAt, since));
  const done = Number(t.done),
    failed = Number(t.failed);
  const failRate = done + failed ? failed / (done + failed) : 0;
  if (failRate > 0.2 && failed >= 2) issues.push(`${Math.round(failRate * 100)}% of tasks failed in the last 24h`);
  const [att] = await db.select({ c: sql<number>`count(*)` }).from(schema.agents).where(and(eq(schema.agents.status, "attention"), eq(schema.agents.enabled, true)));
  if (Number(att.c)) issues.push(`${att.c} agent(s) need attention`);
  let score = 100;
  if (!workerUp) score -= 45;
  if (!ai) score -= 40;
  score -= Math.round(failRate * 30);
  score -= Math.min(15, Number(att.c) * 3);
  score = Math.max(0, score);
  return { score, label: score >= 85 ? "Operational" : score >= 50 ? "Degraded" : "Offline", issues, workerUp, ai };
}
