/**
 * Idempotent seed: the 36 agents and the default workflows.
 * Existing rows are left untouched so your edits (prompts, models, permissions) survive.
 * Run: npm run db:seed   (add --reset-agents to restore catalog prompts/tools)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { db, schema, sql } = await import("./index");
  const { AGENTS, DEFAULT_MODEL } = await import("../server/agents/catalog");
  const reset = process.argv.includes("--reset-agents");

  let order = 0;
  for (const a of AGENTS) {
    const values = {
      id: a.id,
      department: a.department,
      name: a.name,
      role: a.role,
      description: a.description,
      systemPrompt: a.systemPrompt,
      inputFormat: a.inputFormat,
      outputFormat: a.outputFormat,
      model: DEFAULT_MODEL,
      effort: a.effort,
      tools: a.tools,
      permissions: a.permissions,
      sortOrder: order++,
      maxIterations: a.id === "ceo" || a.id === "quality-controller" ? 16 : 12,
    };
    if (reset) {
      await db.insert(schema.agents).values(values).onConflictDoUpdate({ target: schema.agents.id, set: { ...values, updatedAt: new Date() } });
    } else {
      await db.insert(schema.agents).values(values).onConflictDoNothing();
    }
  }
  console.log(`✓ ${AGENTS.length} agents`);

  const existing = await db.select({ name: schema.workflows.name }).from(schema.workflows);
  const has = (n: string) => existing.some((e) => e.name === n);
  type N = (typeof schema.workflows.$inferInsert)["nodes"];

  const chain = (steps: { agentId: string; label: string; instructions: string; type?: "agent" | "approval" | "condition"; data?: Record<string, unknown> }[], trigger = "Every morning") => {
    const nodes: NonNullable<N> = [{ id: "trigger", type: "trigger", position: { x: 260, y: 0 }, data: { label: trigger } }];
    const edges: { id: string; source: string; target: string }[] = [];
    let prev = "trigger";
    steps.forEach((s, i) => {
      const id = `s${i + 1}`;
      nodes.push({ id, type: s.type ?? "agent", position: { x: 260, y: (i + 1) * 170 }, data: { label: s.label, agentId: s.agentId || undefined, instructions: s.instructions, ...(s.data ?? {}) } });
      edges.push({ id: `e${i + 1}`, source: prev, target: id });
      prev = id;
    });
    return { nodes, edges };
  };

  const defs: { name: string; description: string; schedule: string; graph: ReturnType<typeof chain> }[] = [];

  // The flagship loop from the brief, with parallel research.
  {
    const nodes: NonNullable<N> = [
      { id: "trigger", type: "trigger", position: { x: 380, y: 0 }, data: { label: "Every morning 06:00" } },
      { id: "trend", type: "agent", position: { x: 60, y: 182 }, data: { label: "Research trends", agentId: "trend-scout", instructions: "Research emerging trends in our market over the last 7 days. Return the 5–8 most relevant with sources and content angles." } },
      { id: "audience", type: "agent", position: { x: 380, y: 182 }, data: { label: "Audience interests", agentId: "audience-listener", instructions: "Identify what our audience is asking and feeling this week. Return top themes with evidence and FAQ candidates." } },
      { id: "competitors", type: "agent", position: { x: 700, y: 182 }, data: { label: "Competitor scan", agentId: "competitor-watch", instructions: "Check what changed at our main competitors since your last run and list openings for us." } },
      { id: "ceo", type: "agent", position: { x: 380, y: 377 }, data: { label: "Pick today's angles", agentId: "ceo", instructions: "Evaluate the research above. Choose the 3 strongest content angles for today, each with platform, format and why. Do NOT delegate — the workflow continues automatically; just output the brief." } },
      { id: "design", type: "agent", position: { x: 380, y: 559 }, data: { label: "Create concepts & visuals", agentId: "visual-designer", instructions: "Turn the CEO's 3 angles into content items (create_content), each with hook, script/copy, caption, hashtags and a generated visual where an image provider is connected." } },
      { id: "voice", type: "agent", position: { x: 380, y: 741 }, data: { label: "Voiceovers", agentId: "voiceover-producer", instructions: "For video content items created in this run that have a script, write the voice script and produce the voiceover." } },
      { id: "brand", type: "agent", position: { x: 380, y: 923 }, data: { label: "Brand check", agentId: "brand-guardian", instructions: "Review all draft content items created today. Pass the good ones to in_review; fix or flag the rest." } },
      { id: "approve", type: "agent", position: { x: 380, y: 1105 }, data: { label: "Request approval", agentId: "approval-manager", instructions: "Create approval requests for every content item in review." } },
      { id: "schedule", type: "agent", position: { x: 380, y: 1287 }, data: { label: "Schedule approved", agentId: "content-scheduler", instructions: "Schedule all approved, unscheduled content at the best times in the next 3 days." } },
      { id: "perf", type: "agent", position: { x: 380, y: 1469 }, data: { label: "Track results", agentId: "performance-analyst", instructions: "Refresh engagement metrics and report what performed best this week and what didn't." } },
      { id: "loop", type: "agent", position: { x: 380, y: 1651 }, data: { label: "Feed the loop", agentId: "loop-feeder", instructions: "Based on the performance report, queue the next round of tasks (no duplicates)." } },
    ];
    const edges = [
      ["trigger", "trend"], ["trigger", "audience"], ["trigger", "competitors"],
      ["trend", "ceo"], ["audience", "ceo"], ["competitors", "ceo"],
      ["ceo", "design"], ["design", "voice"], ["voice", "brand"], ["brand", "approve"], ["approve", "schedule"], ["schedule", "perf"], ["perf", "loop"],
    ].map(([s, t], i) => ({ id: `e${i}`, source: s, target: t }));
    defs.push({ name: "Daily content engine", description: "Research → CEO picks angles → content, voice, brand check → approval → schedule → measure → feed the loop. Publishing agents publish automatically when items come due.", schedule: "0 6 * * *", graph: { nodes, edges } });
  }

  defs.push({
    name: "Sales pipeline",
    description: "Find prospects, qualify them, draft outreach (sending always needs your approval) and keep the CRM clean.",
    schedule: "0 9 * * 1-5",
    graph: chain([
      { agentId: "lead-finder", label: "Find prospects", instructions: "Find 8–12 new prospects that match our ICP." },
      { agentId: "lead-qualifier", label: "Qualify", instructions: "Research and score all new leads." },
      { agentId: "", label: "Any qualified?", instructions: "", type: "condition", data: { mode: "data_gte", field: "qualified", value: "1" } },
      { agentId: "outreach-writer", label: "Draft outreach", instructions: "Write personalised first-touch emails for newly qualified leads and request sending." },
      { agentId: "follow-up-assistant", label: "Follow-ups", instructions: "Prepare today's due follow-ups." },
      { agentId: "crm-manager", label: "CRM hygiene", instructions: "Clean the pipeline and sync to the CRM if connected." },
    ], "Weekdays 09:00"),
  });
  defs.push({
    name: "Community sweep",
    description: "Pull comments & mentions, triage, draft replies and measure sentiment.",
    schedule: "0 */3 * * *",
    graph: chain([
      { agentId: "comment-monitor", label: "Pull & triage", instructions: "Fetch new comments and mentions and triage them." },
      { agentId: "response-writer", label: "Draft replies", instructions: "Draft replies for open conversations." },
      { agentId: "dm-assistant", label: "DMs", instructions: "Handle open DMs." },
      { agentId: "sentiment-analyst", label: "Sentiment", instructions: "Classify new conversations and report shifts." },
    ], "Every 3 hours"),
  });
  defs.push({
    name: "Nightly memory & improvement",
    description: "Quality review, memory consolidation and KPI analysis, then the Loop Feeder queues tomorrow's improvements.",
    schedule: "30 22 * * *",
    graph: chain([
      { agentId: "quality-controller", label: "Review today's work", instructions: "Review today's completed tasks that have no quality score yet." },
      { agentId: "memory-manager", label: "Consolidate memory", instructions: "Distil today's outputs and decisions into company memory." },
      { agentId: "performance-analyst", label: "KPIs", instructions: "Report today's operational KPIs and bottlenecks." },
      { agentId: "loop-feeder", label: "Queue improvements", instructions: "Turn the findings into tomorrow's tasks or workflow proposals." },
    ], "Nightly 22:30"),
  });
  defs.push({
    name: "Weekly intelligence",
    description: "Industry digest, market analysis, reputation scan and a newsletter issue for your approval.",
    schedule: "0 7 * * 1",
    graph: chain([
      { agentId: "email-intelligence", label: "Industry digest", instructions: "Write this week's industry digest." },
      { agentId: "market-analyst", label: "Opportunities", instructions: "Analyse the latest research and rank opportunities." },
      { agentId: "reputation-monitor", label: "Reputation", instructions: "Scan for brand mentions and risks." },
      { agentId: "", label: "Approve newsletter draft", instructions: "", type: "approval", data: { title: "Assemble this week's newsletter?" } },
      { agentId: "newsletter-publisher", label: "Assemble newsletter", instructions: "assemble — build this week's issue from the research above." },
    ], "Mondays 07:00"),
  });

  for (const d of defs) {
    if (has(d.name)) continue;
    await db.insert(schema.workflows).values({
      name: d.name,
      description: d.description,
      enabled: false,
      triggerType: "schedule",
      schedule: d.schedule,
      nodes: d.graph.nodes,
      edges: d.graph.edges,
      system: true,
    });
  }
  console.log(`✓ ${defs.length} default workflows (created disabled — enable them on the Workflows page)`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
