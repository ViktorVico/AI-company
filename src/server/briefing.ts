import { appUrl } from "@/lib/app-url";
import { db, schema } from "@/db";
import { and, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { getSetting, appTimezone } from "@/server/lib/settings";
import { emit, notify } from "@/server/lib/events";
import { anthropicClient, sendEmail, sendSlack } from "@/server/integrations/providers";
import { isConfigured, getCredentials, INTEGRATIONS } from "@/server/integrations/registry";
import { nextRuns } from "@/server/workflows/engine";
import { DEPARTMENTS } from "@/server/agents/catalog";

export type BriefingData = Awaited<ReturnType<typeof collectBriefingData>>;

function localDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: appTimezone(), year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Everything in the briefing comes from the database — no invented numbers. */
export async function collectBriefingData() {
  const since = new Date(Date.now() - 24 * 3600_000);
  const endOfToday = new Date(Date.now() + 24 * 3600_000);
  const agents = await db.select().from(schema.agents);
  const agentName = new Map(agents.map((a) => [a.id, a]));

  const completed = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.status, "completed"), gte(schema.tasks.completedAt, since)))
    .orderBy(desc(schema.tasks.completedAt));
  const failed = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.status, "failed"), gte(schema.tasks.completedAt, since)))
    .orderBy(desc(schema.tasks.completedAt));

  const byDept: Record<string, { name: string; completed: number; highlights: { agent: string; summary: string; taskId: string }[] }> = {};
  for (const d of DEPARTMENTS) byDept[d.id] = { name: d.name, completed: 0, highlights: [] };
  for (const t of completed) {
    const a = agentName.get(t.agentId);
    if (!a) continue;
    const b = byDept[a.department];
    b.completed++;
    if (b.highlights.length < 4) b.highlights.push({ agent: a.name, summary: t.summary ?? t.title, taskId: t.id });
  }

  const contentCreated = await db.select({ c: sql<number>`count(*)` }).from(schema.contentItems).where(gte(schema.contentItems.createdAt, since));
  const published = await db.select().from(schema.contentItems).where(and(eq(schema.contentItems.status, "published"), gte(schema.contentItems.publishedAt, since)));
  const leadsNew = await db.select({ c: sql<number>`count(*)` }).from(schema.leads).where(gte(schema.leads.createdAt, since));
  const leadsQualified = await db.select().from(schema.leads).where(and(eq(schema.leads.stage, "qualified"), gte(schema.leads.updatedAt, since))).orderBy(desc(schema.leads.score)).limit(5);

  // research opportunity counts reported by agents in structured data
  const sumData = (agentId: string, key: string) =>
    completed.filter((t) => t.agentId === agentId).reduce((s, t) => s + (typeof t.data?.[key] === "number" ? (t.data[key] as number) : Array.isArray(t.data?.[key]) ? (t.data![key] as unknown[]).length : 0), 0);

  const recentPublished = await db
    .select()
    .from(schema.contentItems)
    .where(and(eq(schema.contentItems.status, "published"), gte(schema.contentItems.publishedAt, new Date(Date.now() - 7 * 86400_000))));
  const eng = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + (Number(b) || 0), 0);
  const bestContent = recentPublished
    .filter((c) => Object.keys(c.metrics).length)
    .sort((a, b) => eng(b.metrics) - eng(a.metrics))
    .slice(0, 3)
    .map((c) => ({ id: c.id, title: c.title, platform: c.platform, url: c.externalUrl, metrics: c.metrics }));
  const bestWork = completed
    .filter((t) => t.qualityScore != null)
    .sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))
    .slice(0, 3)
    .map((t) => ({ taskId: t.id, agent: agentName.get(t.agentId)?.name, summary: t.summary, score: t.qualityScore }));

  const scheduledToday = await db
    .select()
    .from(schema.contentItems)
    .where(and(eq(schema.contentItems.status, "scheduled"), lte(schema.contentItems.scheduledFor, endOfToday)))
    .orderBy(schema.contentItems.scheduledFor);
  const workflows = await db.select().from(schema.workflows).where(and(eq(schema.workflows.enabled, true), eq(schema.workflows.triggerType, "schedule")));
  const workflowsToday = workflows
    .map((w) => ({ id: w.id, name: w.name, next: nextRuns(w.schedule ?? "", 1)[0] }))
    .filter((w) => w.next && w.next < endOfToday)
    .sort((a, b) => a.next!.getTime() - b.next!.getTime());
  const followUps = await db
    .select()
    .from(schema.leads)
    .where(and(lte(schema.leads.nextFollowUpAt, endOfToday), inArray(schema.leads.stage, ["contacted", "replied", "meeting"])));
  const queued = await db.select({ c: sql<number>`count(*)` }).from(schema.tasks).where(inArray(schema.tasks.status, ["queued", "blocked"]));

  const pendingApprovals = await db.select().from(schema.approvals).where(eq(schema.approvals.status, "pending")).orderBy(desc(schema.approvals.createdAt));
  const escalations = await db.select().from(schema.conversations).where(eq(schema.conversations.status, "escalated")).limit(10);
  const attentionAgents = agents.filter((a) => a.status === "attention").map((a) => ({ id: a.id, name: a.name }));
  const disconnected: string[] = [];
  for (const i of INTEGRATIONS) if (!(await isConfigured(i.id))) disconnected.push(i.name);
  const [cost] = await db.select({ s: sql<number>`coalesce(sum(cost_usd),0)` }).from(schema.tasks).where(gte(schema.tasks.createdAt, since));

  return {
    generatedAt: new Date().toISOString(),
    forDate: localDate(),
    happened: {
      tasksCompleted: completed.length,
      tasksFailed: failed.length,
      opportunities: sumData("market-analyst", "opportunities") + sumData("trend-scout", "trends"),
      contentCreated: Number(contentCreated[0].c),
      published: published.length,
      leadsNew: Number(leadsNew[0].c),
      leadsQualified: leadsQualified.length,
      costUsd: Math.round(Number(cost.s) * 100) / 100,
      byDepartment: byDept,
    },
    worked: { bestContent, bestWork, qualifiedLeads: leadsQualified.map((l) => ({ id: l.id, name: l.name, company: l.company, score: l.score, reason: l.scoreReason })) },
    today: {
      publications: scheduledToday.map((c) => ({ id: c.id, title: c.title, platform: c.platform, at: c.scheduledFor })),
      workflows: workflowsToday,
      followUps: followUps.map((l) => ({ id: l.id, name: l.name, company: l.company, at: l.nextFollowUpAt })),
      queuedTasks: Number(queued[0].c),
    },
    attention: {
      approvals: pendingApprovals.map((a) => ({ id: a.id, title: a.title, category: a.category, risk: a.risk, createdAt: a.createdAt })),
      failedTasks: failed.slice(0, 8).map((t) => ({ id: t.id, title: t.title, agent: agentName.get(t.agentId)?.name, error: t.error })),
      escalations: escalations.map((c) => ({ id: c.id, author: c.author, platform: c.platform, text: c.text.slice(0, 200) })),
      agents: attentionAgents,
      disconnected,
    },
  };
}

async function writeNarrative(data: BriefingData): Promise<string | null> {
  const ceo = await db.query.agents.findFirst({ where: eq(schema.agents.id, "ceo") });
  if (!ceo || !(await isConfigured("anthropic"))) return null;
  const profile = await getSetting("businessProfile");
  const client = await anthropicClient();
  const msg = await client.messages.create({
    model: ceo.model,
    max_tokens: 2000,
    output_config: { effort: "low" },
    system: `You are the CEO Agent of an AI-run company writing the owner's morning briefing. Write 4–6 crisp sentences: what moved yesterday, what it means, and the one or two decisions the owner should make today. Use ONLY the numbers and items in the JSON — never invent data. If little happened, say so plainly. No headings, no bullet lists, no greeting.`,
    messages: [{ role: "user", content: `Owner: ${profile.ownerName || "the owner"}\n\n${JSON.stringify(data)}` }],
  });
  if (msg.stop_reason === "refusal") return null;
  const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
  const cost = ((msg.usage.input_tokens ?? 0) * 4 + (msg.usage.output_tokens ?? 0) * 20) / 1e6;
  await emit("briefing.narrative", `CEO Agent wrote the morning briefing narrative`, { agentId: "ceo", data: { costUsd: cost } });
  return text || null;
}

export function briefingToText(data: BriefingData, narrative: string | null) {
  const h = data.happened;
  const lines = [
    `Good morning — ${data.forDate}`,
    "",
    narrative ?? "",
    "",
    "WHAT HAPPENED (last 24h)",
    `• ${h.tasksCompleted} tasks completed, ${h.tasksFailed} failed`,
    `• ${h.opportunities} opportunities/trends identified`,
    `• ${h.contentCreated} content assets created, ${h.published} published`,
    `• ${h.leadsNew} new leads, ${h.leadsQualified} qualified`,
    `• AI spend: $${h.costUsd}`,
    "",
    "TODAY",
    `• ${data.today.publications.length} publications scheduled`,
    `• ${data.today.workflows.length} workflows will run`,
    `• ${data.today.followUps.length} sales follow-ups due`,
    "",
    "NEEDS YOUR ATTENTION",
    `• ${data.attention.approvals.length} approvals waiting`,
    `• ${data.attention.failedTasks.length} failed tasks`,
    `• ${data.attention.escalations.length} escalated conversations`,
    ...(data.attention.disconnected.length ? [`• Not connected: ${data.attention.disconnected.join(", ")}`] : []),
  ];
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}

export async function generateBriefing(opts: { deliver?: boolean } = {}) {
  const settings = await getSetting("briefing");
  const data = await collectBriefingData();
  let narrative: string | null = null;
  if (settings.narrative) {
    try {
      narrative = await writeNarrative(data);
    } catch (e) {
      console.error("briefing narrative failed", e);
    }
  }
  const delivered: string[] = [];
  const [row] = await db.insert(schema.briefings).values({ forDate: data.forDate, data, narrative, deliveredVia: delivered }).returning({ id: schema.briefings.id });

  if (opts.deliver) {
    const text = briefingToText(data, narrative);
    if (settings.channels.includes("in_app")) {
      await notify("briefing", "Your morning briefing is ready", narrative?.slice(0, 280) ?? undefined, "/briefing");
      delivered.push("in_app");
    }
    if (settings.channels.includes("email")) {
      const { creds } = await getCredentials("resend");
      if (creds.briefingTo) {
        try {
          await sendEmail({ to: creds.briefingTo, subject: `Morning briefing — ${data.forDate}`, text: `${text}\n\n${appUrl()}/briefing` });
          delivered.push("email");
        } catch (e) {
          console.error("briefing email failed", (e as Error).message);
        }
      }
    }
    if (settings.channels.includes("slack")) {
      try {
        if (await sendSlack("```" + text + "```", { silentIfMissing: true })) delivered.push("slack");
      } catch (e) {
        console.error("briefing slack failed", (e as Error).message);
      }
    }
    await db.update(schema.briefings).set({ deliveredVia: delivered }).where(eq(schema.briefings.id, row.id));
  }
  await emit("briefing.generated", `Morning briefing generated${delivered.length ? ` and delivered via ${delivered.join(", ")}` : ""}`);
  return row.id;
}

export async function latestBriefing() {
  return db.query.briefings.findFirst({ orderBy: desc(schema.briefings.id) });
}

void lt;
