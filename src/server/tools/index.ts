import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db, schema } from "@/db";
import { and, desc, eq, gte, ilike, inArray, isNull, or, sql, lte } from "drizzle-orm";
import type { Agent, Task } from "@/db/schema";
import { emit, notify } from "@/server/lib/events";
import { requestOrExecute, createApproval } from "@/server/actions";
import { generateImage, generateSpeech, fetchMetrics, fetchComments, hubspotUpsertContact, PLATFORM_INTEGRATION } from "@/server/integrations/providers";
import { isConfigured } from "@/server/integrations/registry";
import { createTask } from "@/server/tasks";
import { searchKnowledge } from "@/server/memory";
import { getMetrics } from "@/server/metrics";

export type ToolContext = { agent: Agent; task: Task; createdTaskIds: string[] };

type ToolDef = {
  description: string;
  schema: z.ZodObject;
  permission?: string; // required agent permission
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (input: any, ctx: ToolContext) => Promise<unknown>;
};

const PLATFORMS = ["instagram", "tiktok", "youtube", "x", "linkedin", "newsletter"] as const;
const FORMATS = ["post", "reel", "short", "video", "carousel", "thread", "newsletter", "poll", "story"] as const;
const iso = z.string().describe("ISO 8601 timestamp");

function slimContent(c: typeof schema.contentItems.$inferSelect) {
  return {
    id: c.id,
    platform: c.platform,
    format: c.format,
    title: c.title,
    hook: c.hook,
    status: c.status,
    caption: c.caption?.slice(0, 400),
    hasScript: !!c.script,
    assets: c.assets,
    brandCheck: c.brandCheck,
    scheduledFor: c.scheduledFor,
    publishedAt: c.publishedAt,
    externalUrl: c.externalUrl,
    metrics: c.metrics,
  };
}

export const TOOLS: Record<string, ToolDef> = {
  /* ───── knowledge & memory ───── */
  search_knowledge: {
    description:
      "Search the company knowledge base (objectives, brand, audience, products, pricing, tone, competitors, strategy, campaigns) and shared company memory. Use before making claims about the business.",
    schema: z.object({ query: z.string().describe("Keywords to search for"), category: z.string().optional() }),
    run: async (i, ctx) => searchKnowledge(i.query, { category: i.category, agentId: ctx.agent.id }),
  },
  remember: {
    description:
      "Store a durable memory. scope 'agent' = your private specialised memory; scope 'company' = shared with every agent (requires permission).",
    schema: z.object({
      scope: z.enum(["agent", "company"]),
      kind: z.enum(["note", "decision", "insight", "preference", "fact"]),
      title: z.string(),
      content: z.string(),
      importance: z.number().int().min(1).max(5).default(3),
    }),
    run: async (i, ctx) => {
      if (i.scope === "company" && !ctx.agent.permissions.includes("memory:company"))
        throw new Error("You do not have permission to write company memory. Use scope 'agent' or ask Memory Manager.");
      const [m] = await db
        .insert(schema.memories)
        .values({ scope: i.scope, agentId: i.scope === "agent" ? ctx.agent.id : ctx.agent.id, kind: i.kind, title: i.title, content: i.content, importance: i.importance, source: `task:${ctx.task.id}` })
        .returning({ id: schema.memories.id });
      return { saved: true, id: m.id };
    },
  },

  /* ───── agent communication ───── */
  send_message: {
    description: "Send a message to another agent (by agent id). They will see it in their inbox on their next task.",
    schema: z.object({ to: z.string().describe("agent id, e.g. 'ceo'"), subject: z.string(), body: z.string() }),
    run: async (i, ctx) => {
      const to = await db.query.agents.findFirst({ where: eq(schema.agents.id, i.to) });
      if (!to) throw new Error(`Unknown agent "${i.to}"`);
      await db.insert(schema.agentMessages).values({ fromAgent: ctx.agent.id, toAgent: i.to, subject: i.subject, body: i.body, taskId: ctx.task.id });
      await emit("agent.message", `${ctx.agent.name} → ${to.name}: ${i.subject}`, { agentId: ctx.agent.id, taskId: ctx.task.id });
      return { delivered: true };
    },
  },
  read_inbox: {
    description: "Read unread messages other agents sent you. Marks them as read.",
    schema: z.object({}),
    run: async (_i, ctx) => {
      const msgs = await db
        .select()
        .from(schema.agentMessages)
        .where(and(eq(schema.agentMessages.toAgent, ctx.agent.id), isNull(schema.agentMessages.readAt)))
        .orderBy(desc(schema.agentMessages.id))
        .limit(30);
      if (msgs.length)
        await db.update(schema.agentMessages).set({ readAt: new Date() }).where(inArray(schema.agentMessages.id, msgs.map((m) => m.id)));
      return msgs.map((m) => ({ from: m.fromAgent, subject: m.subject, body: m.body, at: m.createdAt }));
    },
  },

  /* ───── tasks ───── */
  list_tasks: {
    description: "List recent tasks across the company (or for one agent/department) with status and one-line summaries.",
    schema: z.object({
      agentId: z.string().optional(),
      status: z.enum(["queued", "blocked", "running", "completed", "failed", "cancelled"]).optional(),
      sinceHours: z.number().default(72),
      limit: z.number().int().max(50).default(25),
      unreviewedOnly: z.boolean().optional().describe("Only completed tasks without a quality score"),
    }),
    run: async (i) => {
      const conds = [gte(schema.tasks.createdAt, new Date(Date.now() - i.sinceHours * 3600_000))];
      if (i.agentId) conds.push(eq(schema.tasks.agentId, i.agentId));
      if (i.status) conds.push(eq(schema.tasks.status, i.status));
      if (i.unreviewedOnly) conds.push(isNull(schema.tasks.qualityScore), eq(schema.tasks.status, "completed"));
      const rows = await db
        .select({ id: schema.tasks.id, agentId: schema.tasks.agentId, title: schema.tasks.title, status: schema.tasks.status, summary: schema.tasks.summary, qualityScore: schema.tasks.qualityScore, createdAt: schema.tasks.createdAt })
        .from(schema.tasks)
        .where(and(...conds))
        .orderBy(desc(schema.tasks.createdAt))
        .limit(i.limit);
      return rows;
    },
  },
  get_task_output: {
    description: "Read the full output and structured data of a task.",
    schema: z.object({ taskId: z.string() }),
    run: async (i) => {
      const t = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, i.taskId) });
      if (!t) throw new Error("Task not found");
      return { id: t.id, agentId: t.agentId, title: t.title, instructions: t.instructions, status: t.status, summary: t.summary, output: t.output?.slice(0, 20000), data: t.data, error: t.error };
    },
  },
  delegate_task: {
    description:
      "Create a task for another agent. Give one concrete deliverable with context and acceptance criteria. Use dependsOn with task ids created earlier so the task waits for their output.",
    permission: "tasks:delegate",
    schema: z.object({
      agentId: z.string(),
      title: z.string(),
      instructions: z.string(),
      priority: z.number().int().min(1).max(9).default(5),
      dependsOn: z.array(z.string()).default([]),
    }),
    run: async (i, ctx) => {
      const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, i.agentId) });
      if (!agent) throw new Error(`Unknown agent "${i.agentId}"`);
      // Duplicate guard: same agent + same title still open.
      const dup = await db.query.tasks.findFirst({
        where: and(eq(schema.tasks.agentId, i.agentId), ilike(schema.tasks.title, i.title), inArray(schema.tasks.status, ["queued", "blocked", "running"])),
      });
      if (dup) return { duplicate: true, existingTaskId: dup.id, note: "An open task with this title already exists for that agent." };
      const id = await createTask({
        agentId: i.agentId,
        title: i.title,
        instructions: i.instructions,
        priority: i.priority,
        dependsOn: i.dependsOn,
        createdBy: `agent:${ctx.agent.id}`,
        parentTaskId: ctx.task.id,
      });
      ctx.createdTaskIds.push(id);
      return { created: true, taskId: id, agent: agent.name, enabled: agent.enabled };
    },
  },
  review_task: {
    description: "Score another agent's completed task (0-100) with feedback. Set requestRevision to create a rework task for the same agent.",
    permission: "tasks:review",
    schema: z.object({ taskId: z.string(), score: z.number().int().min(0).max(100), feedback: z.string(), requestRevision: z.boolean().default(false) }),
    run: async (i, ctx) => {
      const t = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, i.taskId) });
      if (!t) throw new Error("Task not found");
      await db.update(schema.tasks).set({ qualityScore: i.score }).where(eq(schema.tasks.id, t.id));
      await db.insert(schema.taskLogs).values({ taskId: t.id, level: i.score < 70 ? "warn" : "info", message: `Quality review by ${ctx.agent.name}: ${i.score}/100 — ${i.feedback}` });
      let revisionTaskId: string | null = null;
      if (i.requestRevision) {
        revisionTaskId = await createTask({
          agentId: t.agentId,
          title: `Revise: ${t.title}`.slice(0, 200),
          instructions: `Your previous output for this task scored ${i.score}/100 in quality review.\n\nReviewer feedback:\n${i.feedback}\n\nOriginal instructions:\n${t.instructions}\n\nPrevious output (task ${t.id}) is available via get_task_output. Produce an improved, complete version.`,
          priority: 3,
          createdBy: `agent:${ctx.agent.id}`,
          parentTaskId: t.id,
        });
        ctx.createdTaskIds.push(revisionTaskId);
      }
      await emit("task.reviewed", `Quality Controller scored “${t.title}” ${i.score}/100${i.requestRevision ? " — revision requested" : ""}`, { agentId: ctx.agent.id, taskId: t.id });
      return { scored: true, revisionTaskId };
    },
  },
  propose_workflow: {
    description: "Propose a new recurring workflow (created DISABLED for the owner to review). Steps run in sequence.",
    permission: "workflows:propose",
    schema: z.object({
      name: z.string(),
      description: z.string(),
      schedule: z.string().optional().describe("cron expression, e.g. '0 6 * * 1-5'"),
      steps: z.array(z.object({ agentId: z.string(), instructions: z.string() })).min(1).max(12),
    }),
    run: async (i, ctx) => {
      const nodes: schema.WorkflowNode[] = [{ id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: { label: i.schedule ? "Schedule" : "Manual" } }];
      const edges: schema.WorkflowEdge[] = [];
      let prev = "trigger";
      i.steps.forEach((s: { agentId: string; instructions: string }, idx: number) => {
        const id = `n${idx + 1}`;
        nodes.push({ id, type: "agent", position: { x: 0, y: (idx + 1) * 140 }, data: { agentId: s.agentId, instructions: s.instructions } });
        edges.push({ id: `e${idx}`, source: prev, target: id });
        prev = id;
      });
      const [w] = await db
        .insert(schema.workflows)
        .values({ name: i.name, description: `${i.description}\n\nProposed by ${ctx.agent.name}.`, enabled: false, triggerType: i.schedule ? "schedule" : "manual", schedule: i.schedule ?? null, nodes, edges })
        .returning({ id: schema.workflows.id });
      await notify("workflow", `New workflow proposed: ${i.name}`, i.description, `/workflows/${w.id}`);
      await emit("workflow.proposed", `${ctx.agent.name} proposed workflow “${i.name}”`, { agentId: ctx.agent.id, taskId: ctx.task.id });
      return { proposed: true, workflowId: w.id, note: "Created disabled; the owner will review and enable it." };
    },
  },
  get_metrics: {
    description: "Real operational metrics: agent performance, task stats, costs, workflow runs, content performance, pipeline and approvals.",
    schema: z.object({ days: z.number().int().min(1).max(90).default(7) }),
    run: async (i) => getMetrics(i.days),
  },
  notify_owner: {
    description: "Send the human owner a notification (in-app and Slack if connected). Use only for things that need their attention.",
    permission: "notify",
    schema: z.object({ title: z.string(), body: z.string(), href: z.string().optional() }),
    run: async (i) => {
      await notify("agent", i.title, i.body, i.href);
      return { notified: true };
    },
  },

  /* ───── content ───── */
  create_content: {
    description: "Create a content draft in the pipeline (status 'draft').",
    permission: "content:create",
    schema: z.object({
      platform: z.enum(PLATFORMS),
      format: z.enum(FORMATS),
      title: z.string().describe("Internal title / for YouTube the video title / for newsletter the subject line"),
      hook: z.string().optional(),
      caption: z.string().optional(),
      script: z.string().optional(),
      body: z.string().optional().describe("Main text: post text, thread (posts separated by a line '---'), slides, newsletter body, poll"),
      hashtags: z.array(z.string()).default([]),
      productionNotes: z.string().optional(),
      imagePrompt: z.string().optional(),
    }),
    run: async (i, ctx) => {
      const [c] = await db
        .insert(schema.contentItems)
        .values({
          platform: i.platform,
          format: i.format,
          title: i.title,
          hook: i.hook,
          caption: i.caption,
          script: i.script,
          body: i.body,
          hashtags: i.hashtags,
          productionNotes: [i.productionNotes, i.imagePrompt ? `Image prompt: ${i.imagePrompt}` : null].filter(Boolean).join("\n\n") || null,
          createdByAgent: ctx.agent.id,
          taskId: ctx.task.id,
        })
        .returning({ id: schema.contentItems.id });
      return { created: true, contentId: c.id };
    },
  },
  update_content: {
    description: "Update a content item: copy fields, attach assets, set brand check, or move between draft and in_review. (Approval, scheduling and publishing have their own tools.)",
    permission: "content:edit",
    schema: z.object({
      contentId: z.string(),
      title: z.string().optional(),
      hook: z.string().optional(),
      caption: z.string().optional(),
      script: z.string().optional(),
      body: z.string().optional(),
      hashtags: z.array(z.string()).optional(),
      productionNotes: z.string().optional(),
      addAssets: z.array(z.object({ kind: z.enum(["image", "audio", "video", "document"]), url: z.string(), label: z.string().optional() })).optional(),
      brandCheck: z.object({ passed: z.boolean(), score: z.number().optional(), notes: z.string() }).optional(),
      status: z.enum(["draft", "in_review"]).optional(),
    }),
    run: async (i) => {
      const item = await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, i.contentId) });
      if (!item) throw new Error("Content item not found");
      if (["published", "publishing"].includes(item.status)) throw new Error("Published content cannot be edited.");
      const patch: Partial<typeof schema.contentItems.$inferInsert> = { updatedAt: new Date() };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
for (const k of ["title", "hook", "caption", "script", "body", "hashtags", "productionNotes", "brandCheck"] as const) if (i[k] !== undefined) (patch as any)[k] = i[k];
      if (i.addAssets) patch.assets = [...item.assets, ...i.addAssets];
      if (i.status) {
        if (["approved", "scheduled"].includes(item.status)) throw new Error("Approved content cannot be moved back by an agent.");
        patch.status = i.status;
      }
      await db.update(schema.contentItems).set(patch).where(eq(schema.contentItems.id, item.id));
      return { updated: true };
    },
  },
  list_content: {
    description: "List content items in the pipeline.",
    schema: z.object({
      status: z.enum(["draft", "in_review", "approved", "scheduled", "publishing", "published", "failed", "rejected"]).optional(),
      platform: z.enum(PLATFORMS).optional(),
      dueOnly: z.boolean().optional().describe("Only scheduled items whose time has come"),
      ids: z.array(z.string()).optional(),
      limit: z.number().int().max(50).default(20),
    }),
    run: async (i) => {
      const conds = [];
      if (i.status) conds.push(eq(schema.contentItems.status, i.status));
      if (i.platform) conds.push(eq(schema.contentItems.platform, i.platform));
      if (i.dueOnly) conds.push(lte(schema.contentItems.scheduledFor, new Date()));
      if (i.ids?.length) conds.push(inArray(schema.contentItems.id, i.ids));
      const rows = await db.select().from(schema.contentItems).where(conds.length ? and(...conds) : undefined).orderBy(desc(schema.contentItems.updatedAt)).limit(i.limit);
      return rows.map((c) => ({ ...slimContent(c), script: c.script?.slice(0, 1500), body: c.body?.slice(0, 2000) }));
    },
  },
  generate_image: {
    description: "Generate an image with the connected image provider and store it. Returns a URL to attach with update_content.",
    permission: "media:generate",
    schema: z.object({ prompt: z.string(), orientation: z.enum(["square", "portrait", "landscape"]).default("square"), contentId: z.string().optional() }),
    run: async (i, ctx) => {
      const size = i.orientation === "portrait" ? "1024x1536" : i.orientation === "landscape" ? "1536x1024" : "1024x1024";
      const f = await generateImage(i.prompt, size);
      if (i.contentId) {
        const item = await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, i.contentId) });
        if (item) await db.update(schema.contentItems).set({ assets: [...item.assets, { kind: "image", url: f.url, prompt: i.prompt }], updatedAt: new Date() }).where(eq(schema.contentItems.id, item.id));
      }
      await emit("media.generated", `${ctx.agent.name} generated an image`, { agentId: ctx.agent.id, taskId: ctx.task.id, data: { url: f.url } });
      return { url: f.url, attachedTo: i.contentId ?? null };
    },
  },
  generate_voiceover: {
    description: "Generate a voiceover (MP3) from a voice-ready script with ElevenLabs and optionally attach it to a content item.",
    permission: "media:generate",
    schema: z.object({ script: z.string().max(5000), contentId: z.string().optional(), voiceId: z.string().optional() }),
    run: async (i, ctx) => {
      const f = await generateSpeech(i.script, i.voiceId);
      if (i.contentId) {
        const item = await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, i.contentId) });
        if (item) await db.update(schema.contentItems).set({ assets: [...item.assets, { kind: "audio", url: f.url, label: "Voiceover" }], updatedAt: new Date() }).where(eq(schema.contentItems.id, item.id));
      }
      await emit("media.generated", `${ctx.agent.name} produced a voiceover`, { agentId: ctx.agent.id, taskId: ctx.task.id, data: { url: f.url } });
      return { url: f.url, bytes: f.bytes };
    },
  },
  request_approval: {
    description: "Ask the human owner to approve something. For content, use category 'content_review' with contentId — approval marks the content approved.",
    permission: "approvals:request",
    schema: z.object({
      category: z.enum(["content_review", "external_communication", "financial", "settings_change", "irreversible"]),
      title: z.string(),
      summary: z.string(),
      contentId: z.string().optional(),
      risk: z.enum(["low", "medium", "high"]).default("medium"),
    }),
    run: async (i, ctx) => {
      if (i.contentId) {
        const pending = await db.query.approvals.findFirst({
          where: and(eq(schema.approvals.status, "pending"), sql`${schema.approvals.payload}->>'contentId' = ${i.contentId}`),
        });
        if (pending) return { alreadyPending: true, approvalId: pending.id };
      }
      const id = await createApproval({
        category: i.category,
        title: i.title,
        summary: i.summary,
        payload: i.contentId ? { contentId: i.contentId } : {},
        risk: i.risk,
        requestedBy: ctx.agent.id,
        taskId: ctx.task.id,
      });
      return { requested: true, approvalId: id };
    },
  },
  schedule_content: {
    description: "Schedule an APPROVED content item for publication at a time.",
    permission: "content:schedule",
    schema: z.object({ contentId: z.string(), at: iso }),
    run: async (i, ctx) => {
      const item = await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, i.contentId) });
      if (!item) throw new Error("Content item not found");
      if (!["approved", "scheduled"].includes(item.status)) throw new Error(`Only approved content can be scheduled (status "${item.status}").`);
      const at = new Date(i.at);
      if (isNaN(at.getTime())) throw new Error("Invalid timestamp");
      await db.update(schema.contentItems).set({ status: "scheduled", scheduledFor: at, updatedAt: new Date() }).where(eq(schema.contentItems.id, item.id));
      await emit("content.scheduled", `${ctx.agent.name} scheduled “${item.title}” on ${item.platform} for ${at.toISOString()}`, { agentId: ctx.agent.id, taskId: ctx.task.id });
      return { scheduled: true, at: at.toISOString() };
    },
  },
  publish_content: {
    description:
      "Publish an approved/scheduled content item through the platform's official API. The owner's approval policy may turn this into an approval request instead.",
    schema: z.object({ contentId: z.string() }),
    run: async (i, ctx) => {
      const item = await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, i.contentId) });
      if (!item) throw new Error("Content item not found");
      const perm = `publish:${item.platform}`;
      if (!ctx.agent.permissions.includes(perm)) throw new Error(`You lack permission ${perm}. Hand this to the right publisher.`);
      if (!(await isConfigured(PLATFORM_INTEGRATION[item.platform]))) throw new Error(`${item.platform} is not connected — cannot publish. Ask the owner to connect it on the Integrations page.`);
      const r = await requestOrExecute({
        type: "publish_content",
        params: { contentId: item.id },
        title: `Publish to ${item.platform}: ${item.title}`,
        summary: `${ctx.agent.name} wants to publish “${item.title}” (${item.format}) to ${item.platform}.${item.brandCheck ? ` Brand score ${item.brandCheck.score ?? "?"}.` : ""}`,
        agentId: ctx.agent.id,
        taskId: ctx.task.id,
      });
      return r;
    },
  },
  fetch_content_metrics: {
    description: "Refresh engagement metrics from platform APIs for published content.",
    schema: z.object({ sinceDays: z.number().int().max(60).default(7), platform: z.enum(PLATFORMS).optional() }),
    run: async (i) => refreshContentMetrics(i.sinceDays, i.platform),
  },

  /* ───── community ───── */
  fetch_comments: {
    description: "Pull new comments and mentions from connected platforms into the conversation inbox.",
    permission: "community:read",
    schema: z.object({ platforms: z.array(z.enum(["x", "instagram", "youtube"])).default(["x", "instagram", "youtube"]) }),
    run: async (i) => {
      const result: Record<string, unknown> = {};
      for (const p of i.platforms as string[]) {
        if (!(await isConfigured(p))) {
          result[p] = "not connected";
          continue;
        }
        try {
          const published = await db
            .select({ id: schema.contentItems.id, externalId: schema.contentItems.externalId })
            .from(schema.contentItems)
            .where(and(eq(schema.contentItems.platform, p), eq(schema.contentItems.status, "published"), gte(schema.contentItems.publishedAt, new Date(Date.now() - 30 * 86400_000))));
          const comments = await fetchComments(p, published.map((x) => x.externalId!).filter(Boolean));
          let added = 0;
          for (const c of comments) {
            const exists = await db.query.conversations.findFirst({ where: and(eq(schema.conversations.platform, p), eq(schema.conversations.externalId, c.externalId)) });
            if (exists) continue;
            await db.insert(schema.conversations).values({
              platform: p,
              kind: c.kind,
              author: c.author,
              text: c.text,
              externalId: c.externalId,
              contentItemId: published.find((x) => x.externalId === c.parentExternalId)?.id ?? null,
            });
            added++;
          }
          result[p] = { fetched: comments.length, new: added };
        } catch (e) {
          result[p] = `error: ${(e as Error).message}`;
        }
      }
      return result;
    },
  },
  list_conversations: {
    description: "List conversations (comments, DMs, mentions) in the community inbox.",
    schema: z.object({
      status: z.enum(["open", "drafted", "replied", "escalated", "closed"]).optional(),
      kind: z.enum(["comment", "dm", "mention"]).optional(),
      sinceDays: z.number().int().default(14),
      limit: z.number().int().max(100).default(40),
    }),
    run: async (i) => {
      const conds = [gte(schema.conversations.createdAt, new Date(Date.now() - i.sinceDays * 86400_000))];
      if (i.status) conds.push(eq(schema.conversations.status, i.status));
      if (i.kind) conds.push(eq(schema.conversations.kind, i.kind));
      return db.select().from(schema.conversations).where(and(...conds)).orderBy(desc(schema.conversations.createdAt)).limit(i.limit);
    },
  },
  update_conversation: {
    description: "Triage a conversation: sentiment, priority, lead signal, draft reply, status.",
    permission: "community:triage",
    schema: z.object({
      conversationId: z.string(),
      sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
      priority: z.enum(["low", "normal", "high", "escalate"]).optional(),
      isLeadSignal: z.boolean().optional(),
      draftReply: z.string().optional(),
      status: z.enum(["open", "drafted", "escalated", "closed"]).optional(),
    }),
    run: async (i) => {
      const { conversationId, ...patch } = i;
      if (patch.priority === "escalate" && !patch.status) patch.status = "escalated";
      await db.update(schema.conversations).set(patch).where(eq(schema.conversations.id, conversationId));
      return { updated: true };
    },
  },
  send_reply: {
    description: "Reply publicly / by DM to a conversation via the platform API. Subject to the owner's approval policy for external communication.",
    permission: "community:reply",
    schema: z.object({ conversationId: z.string(), text: z.string() }),
    run: async (i, ctx) => {
      const conv = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, i.conversationId) });
      if (!conv) throw new Error("Conversation not found");
      if (conv.priority === "escalate") throw new Error("Escalated conversations must be answered by the owner.");
      await db.update(schema.conversations).set({ draftReply: i.text, status: "drafted" }).where(eq(schema.conversations.id, conv.id));
      return requestOrExecute({
        type: "send_reply",
        params: { conversationId: conv.id, text: i.text },
        title: `Reply to ${conv.author} on ${conv.platform}`,
        summary: `“${conv.text.slice(0, 140)}” → “${i.text.slice(0, 200)}”`,
        agentId: ctx.agent.id,
        taskId: ctx.task.id,
        risk: conv.sentiment === "negative" ? "high" : "low",
      });
    },
  },

  /* ───── sales ───── */
  list_leads: {
    description: "List leads in the pipeline.",
    schema: z.object({
      stage: z.enum(["new", "qualified", "contacted", "replied", "meeting", "won", "lost"]).optional(),
      dueFollowUp: z.boolean().optional(),
      ids: z.array(z.string()).optional(),
      search: z.string().optional(),
      limit: z.number().int().max(100).default(50),
    }),
    run: async (i) => {
      const conds = [];
      if (i.stage) conds.push(eq(schema.leads.stage, i.stage));
      if (i.dueFollowUp) conds.push(lte(schema.leads.nextFollowUpAt, new Date()));
      if (i.ids?.length) conds.push(inArray(schema.leads.id, i.ids));
      if (i.search) conds.push(or(ilike(schema.leads.name, `%${i.search}%`), ilike(schema.leads.company, `%${i.search}%`))!);
      return db.select().from(schema.leads).where(conds.length ? and(...conds) : undefined).orderBy(desc(schema.leads.updatedAt)).limit(i.limit);
    },
  },
  create_lead: {
    description: "Add a prospect to the pipeline. Business information from public sources only.",
    permission: "leads:write",
    schema: z.object({
      name: z.string(),
      company: z.string().optional(),
      title: z.string().optional(),
      email: z.string().optional().describe("Only if publicly listed as a business contact"),
      website: z.string().optional(),
      linkedin: z.string().optional(),
      source: z.string().describe("Source URL or channel"),
      notes: z.string().optional(),
    }),
    run: async (i, ctx) => {
      const dup = await db.query.leads.findFirst({
        where: or(i.email ? eq(schema.leads.email, i.email) : sql`false`, and(ilike(schema.leads.name, i.name), i.company ? ilike(schema.leads.company, i.company) : sql`true`)),
      });
      if (dup) return { duplicate: true, leadId: dup.id };
      const [l] = await db.insert(schema.leads).values({ ...i, createdByAgent: ctx.agent.id }).returning({ id: schema.leads.id });
      await emit("lead.created", `${ctx.agent.name} added lead ${i.name}${i.company ? ` (${i.company})` : ""}`, { agentId: ctx.agent.id, taskId: ctx.task.id, data: { leadId: l.id } });
      return { created: true, leadId: l.id };
    },
  },
  update_lead: {
    description: "Update a lead (score, stage, notes, draft outreach, follow-up date).",
    permission: "leads:write",
    schema: z.object({
      leadId: z.string(),
      score: z.number().int().min(0).max(100).optional(),
      scoreReason: z.string().optional(),
      stage: z.enum(["new", "qualified", "contacted", "replied", "meeting", "won", "lost"]).optional(),
      notes: z.string().optional(),
      draftOutreach: z.string().optional(),
      email: z.string().optional(),
      nextFollowUpAt: iso.optional(),
    }),
    run: async (i) => {
      const { leadId, nextFollowUpAt, ...rest } = i;
      await db
        .update(schema.leads)
        .set({ ...rest, ...(nextFollowUpAt ? { nextFollowUpAt: new Date(nextFollowUpAt) } : {}), updatedAt: new Date() })
        .where(eq(schema.leads.id, leadId));
      return { updated: true };
    },
  },
  send_email: {
    description: "Request to send an email to a lead. ALWAYS requires the owner's explicit approval; returns an approval id.",
    permission: "email:send",
    schema: z.object({ leadId: z.string().optional(), to: z.string(), subject: z.string(), body: z.string() }),
    run: async (i, ctx) =>
      requestOrExecute({
        type: "send_email",
        params: i,
        title: `Email ${i.to}: ${i.subject}`,
        summary: i.body.slice(0, 600),
        agentId: ctx.agent.id,
        taskId: ctx.task.id,
      }),
  },
  sync_crm: {
    description: "Push leads to the connected CRM (HubSpot).",
    permission: "crm:sync",
    schema: z.object({ leadIds: z.array(z.string()).optional() }),
    run: async (i) => {
      const rows = i.leadIds?.length
        ? await db.select().from(schema.leads).where(inArray(schema.leads.id, i.leadIds))
        : await db.select().from(schema.leads).orderBy(desc(schema.leads.updatedAt)).limit(100);
      let synced = 0;
      const errors: string[] = [];
      for (const l of rows) {
        try {
          const r = await hubspotUpsertContact(l);
          if (r.id !== l.crmId) await db.update(schema.leads).set({ crmId: r.id }).where(eq(schema.leads.id, l.id));
          synced++;
        } catch (e) {
          errors.push(`${l.name}: ${(e as Error).message}`);
          if ((e as Error).message.includes("not connected")) break;
        }
      }
      return { synced, errors: errors.slice(0, 10) };
    },
  },
};

export async function refreshContentMetrics(sinceDays = 7, platform?: string) {
  const conds = [eq(schema.contentItems.status, "published"), gte(schema.contentItems.publishedAt, new Date(Date.now() - sinceDays * 86400_000))];
  if (platform) conds.push(eq(schema.contentItems.platform, platform));
  const items = await db.select().from(schema.contentItems).where(and(...conds));
  const out: { id: string; platform: string; metrics?: Record<string, number>; error?: string }[] = [];
  for (const it of items) {
    if (!it.externalId) continue;
    try {
      const m = await fetchMetrics(it.platform, it.externalId);
      await db.update(schema.contentItems).set({ metrics: m, metricsUpdatedAt: new Date() }).where(eq(schema.contentItems.id, it.id));
      out.push({ id: it.id, platform: it.platform, metrics: m });
    } catch (e) {
      out.push({ id: it.id, platform: it.platform, error: (e as Error).message });
    }
  }
  return { checked: items.length, results: out };
}

/** Anthropic tool definitions for an agent, filtered by its configured tools. */
export function toolDefinitions(agent: Agent): Anthropic.Beta.Messages.BetaToolUnion[] {
  const defs: Anthropic.Beta.Messages.BetaToolUnion[] = [];
  for (const name of agent.tools) {
    if (name === "web_search") {
      defs.push({ type: "web_search_20260209", name: "web_search", max_uses: 8 });
      continue;
    }
    if (name === "web_fetch") {
      defs.push({ type: "web_fetch_20260209", name: "web_fetch", max_uses: 8 });
      continue;
    }
    const t = TOOLS[name];
    if (!t) continue;
    defs.push({ name, description: t.description, input_schema: z.toJSONSchema(t.schema, { io: "input" }) as Anthropic.Beta.Messages.BetaTool.InputSchema });
  }
  defs.push({
    name: "submit_result",
    description:
      "Finish the task. Call exactly once at the end with a one-sentence summary of what you accomplished (with real counts), the full markdown output, and structured data matching your output format.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One sentence, past tense, with concrete counts, e.g. 'Discovered 9 emerging trends in creator tooling.'" },
        output: { type: "string", description: "Full deliverable in markdown" },
        data: { type: "object", description: "Structured data per your output format", additionalProperties: true },
      },
      required: ["summary", "output"],
    },
  });
  return defs;
}

export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<unknown> {
  const t = TOOLS[name];
  if (!t || !ctx.agent.tools.includes(name)) throw new Error(`Tool "${name}" is not available to ${ctx.agent.name}.`);
  if (t.permission && !ctx.agent.permissions.includes(t.permission)) throw new Error(`${ctx.agent.name} lacks permission "${t.permission}" for ${name}.`);
  const parsed = t.schema.safeParse(input ?? {});
  if (!parsed.success) throw new Error(`Invalid input for ${name}: ${parsed.error.message}`);
  return t.run(parsed.data, ctx);
}

export const TOOL_NAMES = ["web_search", "web_fetch", ...Object.keys(TOOLS)];
export const TOOL_DESCRIPTIONS: Record<string, string> = {
  web_search: "Search the live web (Anthropic server tool).",
  web_fetch: "Fetch and read a web page (Anthropic server tool).",
  ...Object.fromEntries(Object.entries(TOOLS).map(([k, v]) => [k, v.description])),
};
