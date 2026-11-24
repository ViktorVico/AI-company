import { db, schema } from "@/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";

const n = (v: unknown) => Number(v ?? 0);

export async function agentStats(sinceDays = 30) {
  const since = new Date(Date.now() - sinceDays * 86400_000);
  const rows = await db
    .select({
      agentId: schema.tasks.agentId,
      total: sql<number>`count(*)`,
      completed: sql<number>`count(*) filter (where ${schema.tasks.status} = 'completed')`,
      failed: sql<number>`count(*) filter (where ${schema.tasks.status} = 'failed')`,
      avgMs: sql<number>`avg(${schema.tasks.durationMs}) filter (where ${schema.tasks.status} = 'completed')`,
      cost: sql<number>`coalesce(sum(${schema.tasks.costUsd}),0)`,
      tokens: sql<number>`coalesce(sum(${schema.tasks.inputTokens} + ${schema.tasks.outputTokens}),0)`,
      quality: sql<number>`avg(${schema.tasks.qualityScore})`,
    })
    .from(schema.tasks)
    .where(gte(schema.tasks.createdAt, since))
    .groupBy(schema.tasks.agentId);
  return Object.fromEntries(
    rows.map((r) => {
      const done = n(r.completed) + n(r.failed);
      return [
        r.agentId,
        {
          total: n(r.total),
          completed: n(r.completed),
          failed: n(r.failed),
          successRate: done ? n(r.completed) / done : null,
          avgDurationMs: r.avgMs == null ? null : Math.round(n(r.avgMs)),
          costUsd: n(r.cost),
          tokens: n(r.tokens),
          avgQuality: r.quality == null ? null : Math.round(n(r.quality)),
        },
      ];
    }),
  ) as Record<string, { total: number; completed: number; failed: number; successRate: number | null; avgDurationMs: number | null; costUsd: number; tokens: number; avgQuality: number | null }>;
}

export async function getMetrics(days = 7) {
  const since = new Date(Date.now() - days * 86400_000);
  const [tasks] = await db
    .select({
      total: sql<number>`count(*)`,
      completed: sql<number>`count(*) filter (where status = 'completed')`,
      failed: sql<number>`count(*) filter (where status = 'failed')`,
      cost: sql<number>`coalesce(sum(cost_usd),0)`,
      avgMs: sql<number>`avg(duration_ms) filter (where status = 'completed')`,
      avgQuality: sql<number>`avg(quality_score)`,
    })
    .from(schema.tasks)
    .where(gte(schema.tasks.createdAt, since));
  const [open] = await db
    .select({
      running: sql<number>`count(*) filter (where status = 'running')`,
      queued: sql<number>`count(*) filter (where status = 'queued')`,
      blocked: sql<number>`count(*) filter (where status = 'blocked')`,
    })
    .from(schema.tasks);
  const runs = await db
    .select({ status: schema.workflowRuns.status, c: sql<number>`count(*)` })
    .from(schema.workflowRuns)
    .where(gte(schema.workflowRuns.startedAt, since))
    .groupBy(schema.workflowRuns.status);
  const content = await db.select({ status: schema.contentItems.status, c: sql<number>`count(*)` }).from(schema.contentItems).groupBy(schema.contentItems.status);
  const published = await db
    .select()
    .from(schema.contentItems)
    .where(and(eq(schema.contentItems.status, "published"), gte(schema.contentItems.publishedAt, since)))
    .orderBy(desc(schema.contentItems.publishedAt));
  const engagement = (m: Record<string, number>) =>
    (m.like_count ?? 0) + (m.likes ?? 0) + (m.likeCount ?? 0) + 2 * ((m.reply_count ?? 0) + (m.comments ?? 0) + (m.commentCount ?? 0)) + 3 * ((m.retweet_count ?? 0) + (m.shares ?? 0) + (m.saved ?? 0));
  const topContent = published
    .map((c) => ({ id: c.id, title: c.title, platform: c.platform, format: c.format, url: c.externalUrl, metrics: c.metrics, engagement: engagement(c.metrics) }))
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, 5);
  const leads = await db.select({ stage: schema.leads.stage, c: sql<number>`count(*)` }).from(schema.leads).groupBy(schema.leads.stage);
  const leadSources = await db
    .select({ source: schema.leads.source, c: sql<number>`count(*)`, avgScore: sql<number>`avg(score)` })
    .from(schema.leads)
    .where(gte(schema.leads.createdAt, since))
    .groupBy(schema.leads.source);
  const [approvals] = await db
    .select({
      pending: sql<number>`count(*) filter (where status = 'pending')`,
      decided: sql<number>`count(*) filter (where decided_at is not null and created_at >= ${since.toISOString()})`,
      avgHours: sql<number>`avg(extract(epoch from (decided_at - created_at)) / 3600) filter (where decided_at is not null and created_at >= ${since.toISOString()})`,
    })
    .from(schema.approvals);
  const sentiment = await db
    .select({ sentiment: schema.conversations.sentiment, c: sql<number>`count(*)` })
    .from(schema.conversations)
    .where(gte(schema.conversations.createdAt, since))
    .groupBy(schema.conversations.sentiment);
  const done = n(tasks.completed) + n(tasks.failed);
  return {
    periodDays: days,
    tasks: {
      total: n(tasks.total),
      completed: n(tasks.completed),
      failed: n(tasks.failed),
      successRate: done ? Math.round((n(tasks.completed) / done) * 100) : null,
      avgDurationSec: tasks.avgMs == null ? null : Math.round(n(tasks.avgMs) / 1000),
      costUsd: Math.round(n(tasks.cost) * 100) / 100,
      avgQuality: tasks.avgQuality == null ? null : Math.round(n(tasks.avgQuality)),
      runningNow: n(open.running),
      queuedNow: n(open.queued),
      blockedNow: n(open.blocked),
    },
    agents: await agentStats(days),
    workflowRuns: Object.fromEntries(runs.map((r) => [r.status, n(r.c)])),
    content: { byStatus: Object.fromEntries(content.map((r) => [r.status, n(r.c)])), publishedInPeriod: published.length, top: topContent },
    pipeline: { byStage: Object.fromEntries(leads.map((r) => [r.stage, n(r.c)])), newBySource: leadSources.map((s) => ({ source: s.source, count: n(s.c), avgScore: s.avgScore == null ? null : Math.round(n(s.avgScore)) })) },
    approvals: { pending: n(approvals.pending), decidedInPeriod: n(approvals.decided), avgDecisionHours: approvals.avgHours == null ? null : Math.round(n(approvals.avgHours) * 10) / 10 },
    community: { sentiment: Object.fromEntries(sentiment.map((s) => [s.sentiment ?? "unclassified", n(s.c)])) },
  };
}
