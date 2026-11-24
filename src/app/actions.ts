"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import crypto from "node:crypto";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { SESSION_COOKIE, signSession } from "@/lib/session";
import { requireOwner } from "@/server/auth";
import { createTask } from "@/server/tasks";
import { enqueueTask, getBoss, QUEUES } from "@/server/queue";
import { audit, emit } from "@/server/lib/events";
import { setSetting, getSetting, DEFAULTS, type ApprovalPolicy, type BusinessProfile, type BriefingSettings } from "@/server/lib/settings";
import { decideApproval } from "@/server/approvals";
import { startRun, cancelRun, syncSchedules, validateGraph } from "@/server/workflows/engine";
import { saveCredentials, INTEGRATIONS } from "@/server/integrations/registry";
import { testIntegration as providerTest, anthropicClient } from "@/server/integrations/providers";
import { generateBriefing } from "@/server/briefing";
import { syncSystemSchedules } from "@/server/schedules";
import { MODEL_OPTIONS, ALL_PERMISSIONS } from "@/server/agents/catalog";
import { TOOL_NAMES } from "@/server/tools";
import { executeAction } from "@/server/actions";

export type Result = { ok: true; message?: string; id?: string } | { ok: false; error: string };
const ok = (message?: string, id?: string): Result => ({ ok: true, message, id });
const fail = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

async function guarded(fn: () => Promise<Result>): Promise<Result> {
  try {
    await requireOwner();
    return await fn();
  } catch (e) {
    return fail(e);
  }
}

/* ───────────── Auth ───────────── */

export async function login(_: unknown, form: FormData): Promise<{ error?: string }> {
  const pw = String(form.get("password") ?? "");
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected) return { error: "ADMIN_PASSWORD is not configured on the server." };
  const a = Buffer.from(pw);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await new Promise((r) => setTimeout(r, 600));
    return { error: "Wrong password." };
  }
  const c = await cookies();
  c.set(SESSION_COOKIE, await signSession(), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  await audit("owner", "auth.login");
  const next = String(form.get("next") || "/");
  redirect(next.startsWith("/") ? next : "/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

/* ───────────── Objectives & tasks ───────────── */

export async function assignObjective(input: { text: string; agentId?: string; priority?: number }): Promise<Result> {
  return guarded(async () => {
    const text = input.text.trim();
    if (text.length < 4) return fail("Describe the objective in a few words.");
    const agentId = input.agentId || "ceo";
    const id = await createTask({
      agentId,
      title: text.split("\n")[0].slice(0, 120),
      instructions:
        agentId === "ceo"
          ? `The owner set this objective:\n\n${text}\n\nPlan it and delegate concrete tasks to the right agents.`
          : agentId === "task-router"
            ? `Route this request to the right agents:\n\n${text}`
            : text,
      priority: input.priority ?? 3,
      createdBy: "owner",
    });
    await audit("owner", "task.assigned", id, { agentId, text });
    revalidatePath("/");
    return ok("Assigned", id);
  });
}

export async function cancelTask(id: string): Promise<Result> {
  return guarded(async () => {
    const t = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, id) });
    if (!t) return fail("Not found");
    if (["completed", "failed", "cancelled"].includes(t.status)) return fail(`Task is already ${t.status}`);
    // Running tasks stop at their next model turn; queued/blocked ones stop now.
    await db.update(schema.tasks).set({ status: "cancelled", completedAt: t.status === "running" ? null : new Date(), error: "Cancelled by owner" }).where(eq(schema.tasks.id, id));
    await emit("task.cancelled", `You cancelled “${t.title}”`, { agentId: t.agentId, taskId: id });
    await audit("owner", "task.cancelled", id);
    revalidatePath(`/tasks/${id}`);
    return ok("Cancelled");
  });
}

export async function retryTask(id: string): Promise<Result> {
  return guarded(async () => {
    const t = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, id) });
    if (!t) return fail("Not found");
    if (!["failed", "cancelled"].includes(t.status)) return fail("Only failed or cancelled tasks can be retried");
    await db.update(schema.tasks).set({ status: "queued", error: null, attempts: 0, completedAt: null, startedAt: null }).where(eq(schema.tasks.id, id));
    await enqueueTask(id, { priority: t.priority });
    await emit("task.retried", `You retried “${t.title}”`, { agentId: t.agentId, taskId: id });
    revalidatePath(`/tasks/${id}`);
    return ok("Queued again");
  });
}

/* ───────────── Agents ───────────── */

export async function setAgentEnabled(id: string, enabled: boolean): Promise<Result> {
  return guarded(async () => {
    await db.update(schema.agents).set({ enabled, status: enabled ? "idle" : "disabled", updatedAt: new Date() }).where(eq(schema.agents.id, id));
    if (enabled) {
      const queued = await db.select().from(schema.tasks).where(and(eq(schema.tasks.agentId, id), eq(schema.tasks.status, "queued")));
      for (const t of queued) await enqueueTask(t.id, { priority: t.priority });
    }
    await audit("owner", enabled ? "agent.activated" : "agent.deactivated", id);
    await emit("agent.toggled", `${enabled ? "Activated" : "Deactivated"} ${id}`, { agentId: id });
    revalidatePath(`/agents/${id}`);
    return ok(enabled ? "Activated" : "Deactivated");
  });
}

const agentPatch = z.object({
  systemPrompt: z.string().min(20).optional(),
  inputFormat: z.string().optional(),
  outputFormat: z.string().optional(),
  model: z.enum(MODEL_OPTIONS.map((m) => m.id) as [string, ...string[]]).optional(),
  effort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  maxIterations: z.number().int().min(2).max(40).optional(),
  tools: z.array(z.enum(TOOL_NAMES as [string, ...string[]])).optional(),
  permissions: z.array(z.enum(ALL_PERMISSIONS.map((p) => p.id) as [string, ...string[]])).optional(),
});

export async function updateAgent(id: string, patch: z.input<typeof agentPatch>): Promise<Result> {
  return guarded(async () => {
    const p = agentPatch.parse(patch);
    const before = await db.query.agents.findFirst({ where: eq(schema.agents.id, id) });
    if (!before) return fail("Agent not found");
    await db.update(schema.agents).set({ ...p, updatedAt: new Date() }).where(eq(schema.agents.id, id));
    await audit("owner", "agent.updated", id, { fields: Object.keys(p) });
    revalidatePath(`/agents/${id}`);
    return ok("Saved");
  });
}

export async function runAgentTask(agentId: string, title: string, instructions: string): Promise<Result> {
  return guarded(async () => {
    if (!title.trim()) return fail("Give the task a title");
    const id = await createTask({ agentId, title, instructions: instructions || title, createdBy: "owner", priority: 3 });
    await audit("owner", "task.assigned", id, { agentId });
    revalidatePath(`/agents/${agentId}`);
    return ok("Task queued", id);
  });
}

export async function addAgentMemory(agentId: string | null, title: string, content: string, kind = "note", importance = 3): Promise<Result> {
  return guarded(async () => {
    await db.insert(schema.memories).values({ scope: agentId ? "agent" : "company", agentId, title, content, kind, importance, source: "owner" });
    revalidatePath(agentId ? `/agents/${agentId}` : "/knowledge");
    return ok("Saved");
  });
}

export async function deleteMemory(id: number): Promise<Result> {
  return guarded(async () => {
    await db.delete(schema.memories).where(eq(schema.memories.id, id));
    await audit("owner", "memory.deleted", String(id));
    return ok("Deleted");
  });
}

/* ───────────── Approvals ───────────── */

export async function decide(id: string, approved: boolean, note?: string): Promise<Result> {
  return guarded(async () => {
    await decideApproval(id, approved, note);
    revalidatePath("/approvals");
    revalidatePath("/");
    return ok(approved ? "Approved" : "Rejected");
  });
}

/* ───────────── Workflows ───────────── */

const nodeSchema = z.object({
  id: z.string(),
  type: z.enum(["trigger", "agent", "condition", "approval", "delay"]),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.string(), z.unknown()),
});
const wfSchema = z.object({
  name: z.string().min(2),
  description: z.string().default(""),
  triggerType: z.enum(["manual", "schedule", "event"]),
  schedule: z.string().nullable().optional(),
  eventType: z.string().nullable().optional(),
  nodes: z.array(nodeSchema),
  edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string(), sourceHandle: z.string().nullable().optional() })),
});

export async function saveWorkflow(id: string | null, input: z.input<typeof wfSchema>): Promise<Result> {
  return guarded(async () => {
    const w = wfSchema.parse(input);
    const errs = validateGraph(w.nodes as never, w.edges);
    if (errs.length) return fail(errs.join(" "));
    if (w.triggerType === "schedule" && !w.schedule) return fail("Set a schedule (cron) for scheduled workflows.");
    const values = { ...w, schedule: w.schedule ?? null, eventType: w.eventType ?? null, nodes: w.nodes as never, updatedAt: new Date() };
    let wid = id;
    if (id) await db.update(schema.workflows).set(values).where(eq(schema.workflows.id, id));
    else wid = (await db.insert(schema.workflows).values(values).returning({ id: schema.workflows.id }))[0].id;
    await syncSchedules();
    await audit("owner", "workflow.saved", wid!);
    revalidatePath("/workflows");
    return ok("Saved", wid!);
  });
}

export async function setWorkflowEnabled(id: string, enabled: boolean): Promise<Result> {
  return guarded(async () => {
    if (enabled) {
      const wf = await db.query.workflows.findFirst({ where: eq(schema.workflows.id, id) });
      const errs = wf ? validateGraph(wf.nodes, wf.edges) : ["Not found"];
      if (errs.length) return fail(errs.join(" "));
    }
    await db.update(schema.workflows).set({ enabled, updatedAt: new Date() }).where(eq(schema.workflows.id, id));
    await syncSchedules();
    await audit("owner", enabled ? "workflow.enabled" : "workflow.paused", id);
    revalidatePath("/workflows");
    return ok(enabled ? "Enabled" : "Paused");
  });
}

export async function runWorkflowNow(id: string): Promise<Result> {
  return guarded(async () => {
    const runId = await startRun(id, "manual");
    await audit("owner", "workflow.run", id, { runId });
    revalidatePath(`/workflows/${id}`);
    return ok("Run started", runId);
  });
}

export async function cancelWorkflowRun(runId: string): Promise<Result> {
  return guarded(async () => {
    await cancelRun(runId);
    await audit("owner", "workflow.run_cancelled", runId);
    return ok("Cancelled");
  });
}

export async function deleteWorkflow(id: string): Promise<Result> {
  return guarded(async () => {
    await db.update(schema.workflows).set({ enabled: false }).where(eq(schema.workflows.id, id));
    await syncSchedules();
    await db.delete(schema.workflows).where(eq(schema.workflows.id, id));
    await audit("owner", "workflow.deleted", id);
    revalidatePath("/workflows");
    return ok("Deleted");
  });
}

/* ───────────── Knowledge ───────────── */

export async function saveDoc(id: number | null, v: { category: string; title: string; content: string }): Promise<Result> {
  return guarded(async () => {
    if (!v.title.trim() || !v.content.trim()) return fail("Title and content are required");
    if (id) await db.update(schema.knowledgeDocs).set({ ...v, updatedAt: new Date() }).where(eq(schema.knowledgeDocs.id, id));
    else id = (await db.insert(schema.knowledgeDocs).values(v).returning({ id: schema.knowledgeDocs.id }))[0].id;
    await audit("owner", "knowledge.saved", String(id), { title: v.title });
    revalidatePath("/knowledge");
    return ok("Saved", String(id));
  });
}

export async function deleteDoc(id: number): Promise<Result> {
  return guarded(async () => {
    await db.delete(schema.knowledgeDocs).where(eq(schema.knowledgeDocs.id, id));
    await audit("owner", "knowledge.deleted", String(id));
    revalidatePath("/knowledge");
    return ok("Deleted");
  });
}

export async function uploadDoc(form: FormData): Promise<Result> {
  return guarded(async () => {
    const file = form.get("file") as File | null;
    const category = String(form.get("category") || "other");
    if (!file || !file.size) return fail("Choose a file");
    if (file.size > 8 * 1024 * 1024) return fail("Max 8 MB");
    const buf = Buffer.from(await file.arrayBuffer());
    let content: string;
    if (file.name.toLowerCase().endsWith(".pdf")) {
      // Extract text from PDFs with Claude (document input).
      const client = await anthropicClient().catch(() => null);
      if (!client) return fail("PDF upload needs Anthropic connected (used to extract the text). Upload .md/.txt/.csv instead.");
      const msg = await client.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 16000,
        output_config: { effort: "low" },
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } },
              { type: "text", text: "Transcribe this document's full text content as clean markdown. Preserve headings, lists and tables. Output only the content." },
            ],
          },
        ],
      });
      content = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    } else {
      content = buf.toString("utf8");
    }
    const [d] = await db.insert(schema.knowledgeDocs).values({ category, title: file.name.replace(/\.[^.]+$/, ""), content, fileName: file.name }).returning({ id: schema.knowledgeDocs.id });
    await audit("owner", "knowledge.uploaded", String(d.id), { file: file.name });
    revalidatePath("/knowledge");
    return ok("Uploaded", String(d.id));
  });
}

/* ───────────── Integrations ───────────── */

export async function saveIntegration(id: string, values: Record<string, string>): Promise<Result> {
  return guarded(async () => {
    if (!INTEGRATIONS.some((i) => i.id === id)) return fail("Unknown integration");
    await saveCredentials(id, values);
    await audit("owner", "integration.credentials_updated", id, { fields: Object.keys(values).filter((k) => values[k]) });
    revalidatePath("/integrations");
    return ok("Saved");
  });
}

export async function setIntegrationEnabled(id: string, enabled: boolean): Promise<Result> {
  return guarded(async () => {
    await db.insert(schema.integrations).values({ id, enabled }).onConflictDoUpdate({ target: schema.integrations.id, set: { enabled, updatedAt: new Date() } });
    await audit("owner", enabled ? "integration.enabled" : "integration.disabled", id);
    revalidatePath("/integrations");
    return ok(enabled ? "Enabled" : "Disabled");
  });
}

export async function testIntegration(id: string): Promise<Result> {
  return guarded(async () => {
    const msg = await providerTest(id);
    revalidatePath("/integrations");
    return ok(msg);
  });
}

/* ───────────── Settings ───────────── */

export async function saveSettings(v: { approvalPolicy?: ApprovalPolicy; businessProfile?: BusinessProfile; briefing?: BriefingSettings }): Promise<Result> {
  return guarded(async () => {
    if (v.approvalPolicy) {
      const before = await getSetting("approvalPolicy");
      await setSetting("approvalPolicy", { ...DEFAULTS.approvalPolicy, ...v.approvalPolicy });
      await audit("owner", "settings.approval_policy", null, { before, after: v.approvalPolicy });
    }
    if (v.businessProfile) {
      await setSetting("businessProfile", { ...DEFAULTS.businessProfile, ...v.businessProfile });
      await audit("owner", "settings.business_profile");
    }
    if (v.briefing) {
      if (!/^\d{2}:\d{2}$/.test(v.briefing.time)) return fail("Briefing time must be HH:MM");
      await setSetting("briefing", { ...DEFAULTS.briefing, ...v.briefing });
      await syncSystemSchedules();
      await audit("owner", "settings.briefing", null, v.briefing);
    }
    revalidatePath("/settings");
    return ok("Saved");
  });
}

export async function generateBriefingNow(deliver = false): Promise<Result> {
  return guarded(async () => {
    const id = await generateBriefing({ deliver });
    revalidatePath("/briefing");
    return ok("Briefing generated", String(id));
  });
}

/* ───────────── Content ───────────── */

export async function updateContentItem(
  id: string,
  v: Partial<{ title: string; hook: string; caption: string; script: string; body: string; productionNotes: string; hashtags: string[]; assets: { kind: string; url: string; label?: string }[] }>,
): Promise<Result> {
  return guarded(async () => {
    const item = await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, id) });
    if (!item) return fail("Not found");
    if (["published", "publishing"].includes(item.status)) return fail("Published content can't be edited");
    await db.update(schema.contentItems).set({ ...v, updatedAt: new Date() }).where(eq(schema.contentItems.id, id));
    revalidatePath(`/content/${id}`);
    return ok("Saved");
  });
}

export async function setContentStatus(id: string, status: "draft" | "in_review" | "approved" | "rejected"): Promise<Result> {
  return guarded(async () => {
    await db.update(schema.contentItems).set({ status, updatedAt: new Date() }).where(eq(schema.contentItems.id, id));
    // Owner decided directly — close any pending review approval for it.
    const pend = await db.select().from(schema.approvals).where(eq(schema.approvals.status, "pending"));
    for (const a of pend)
      if ((a.payload as { contentId?: string }).contentId === id && a.category === "content_review")
        await db.update(schema.approvals).set({ status: status === "approved" ? "approved" : "rejected", decidedAt: new Date(), decisionNote: "Decided on content page" }).where(eq(schema.approvals.id, a.id));
    await audit("owner", `content.${status}`, id);
    await emit("content.status", `You marked content as ${status.replace("_", " ")}`, { data: { contentId: id } });
    revalidatePath(`/content/${id}`);
    return ok("Updated");
  });
}

export async function scheduleContentItem(id: string, at: string): Promise<Result> {
  return guarded(async () => {
    const item = await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, id) });
    if (!item) return fail("Not found");
    if (!["approved", "scheduled", "failed"].includes(item.status)) return fail("Approve the content before scheduling");
    const d = new Date(at);
    if (isNaN(d.getTime())) return fail("Invalid date");
    await db.update(schema.contentItems).set({ status: "scheduled", scheduledFor: d, updatedAt: new Date() }).where(eq(schema.contentItems.id, id));
    await audit("owner", "content.scheduled", id, { at });
    revalidatePath(`/content/${id}`);
    return ok("Scheduled");
  });
}

/** Owner-initiated publish: recorded as an approved approval, executed by the worker. */
export async function publishContentNow(id: string): Promise<Result> {
  return guarded(async () => {
    const item = await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, id) });
    if (!item) return fail("Not found");
    if (!["approved", "scheduled", "failed"].includes(item.status)) return fail("Approve the content first");
    const [a] = await db
      .insert(schema.approvals)
      .values({ category: "publishing", title: `Publish to ${item.platform}: ${item.title}`, summary: "Published manually by the owner.", status: "approved", decidedAt: new Date(), action: { type: "publish_content", params: { contentId: id } }, payload: { contentId: id }, requestedBy: "owner" })
      .returning({ id: schema.approvals.id });
    const boss = await getBoss();
    await boss.send(QUEUES.approvalExecute, { approvalId: a.id }, { retryLimit: 0 });
    await audit("owner", "content.publish_requested", id);
    return ok("Publishing — the result will appear in a moment");
  });
}

export async function deleteContent(id: string): Promise<Result> {
  return guarded(async () => {
    const item = await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, id) });
    if (item?.status === "published") return fail("Published content is kept for history");
    await db.delete(schema.contentItems).where(eq(schema.contentItems.id, id));
    await audit("owner", "content.deleted", id);
    revalidatePath("/content");
    return ok("Deleted");
  });
}

/* ───────────── Leads ───────────── */

export async function saveLead(id: string | null, v: Partial<typeof schema.leads.$inferInsert>): Promise<Result> {
  return guarded(async () => {
    const { id: _i, createdAt: _c, ...rest } = v;
    void _i;
    void _c;
    if (id) await db.update(schema.leads).set({ ...rest, updatedAt: new Date() }).where(eq(schema.leads.id, id));
    else {
      if (!rest.name) return fail("Name is required");
      id = (await db.insert(schema.leads).values({ ...rest, name: rest.name, source: rest.source ?? "manual" }).returning({ id: schema.leads.id }))[0].id;
      await emit("lead.created", `New lead added: ${rest.name}`, { data: { leadId: id } });
    }
    await audit("owner", "lead.saved", id);
    revalidatePath("/leads");
    return ok("Saved", id);
  });
}

/** The owner sending an email is explicit authorization. */
export async function sendLeadEmail(leadId: string, subject: string, body: string): Promise<Result> {
  return guarded(async () => {
    const lead = await db.query.leads.findFirst({ where: eq(schema.leads.id, leadId) });
    if (!lead?.email) return fail("This lead has no email address");
    const r = await executeAction("send_email", { leadId, to: lead.email, subject, body }, "owner");
    revalidatePath("/leads");
    return ok(`Sent (${r.messageId})`);
  });
}

/* ───────────── Community ───────────── */

export async function addConversation(v: { platform: string; kind: string; author: string; text: string }): Promise<Result> {
  return guarded(async () => {
    if (!v.author || !v.text) return fail("Author and text are required");
    await db.insert(schema.conversations).values(v);
    revalidatePath("/community");
    return ok("Added");
  });
}

export async function replyToConversation(id: string, text: string): Promise<Result> {
  return guarded(async () => {
    const r = await executeAction("send_reply", { conversationId: id, text }, "owner");
    revalidatePath("/community");
    return ok(`Reply posted (${r.id})`);
  });
}

export async function setConversationStatus(id: string, status: string): Promise<Result> {
  return guarded(async () => {
    await db.update(schema.conversations).set({ status }).where(eq(schema.conversations.id, id));
    revalidatePath("/community");
    return ok("Updated");
  });
}

/* ───────────── Notifications ───────────── */

export async function markNotificationsRead(): Promise<Result> {
  return guarded(async () => {
    const unread = await db.select({ id: schema.notifications.id }).from(schema.notifications);
    if (unread.length) await db.update(schema.notifications).set({ readAt: new Date() }).where(inArray(schema.notifications.id, unread.map((u) => u.id)));
    return ok();
  });
}
