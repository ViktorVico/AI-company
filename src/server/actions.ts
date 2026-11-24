/**
 * External / sensitive actions. Every one goes through `requestOrExecute`, which
 * consults the owner's approval policy, and is fully traceable (approvals + audit log).
 */
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { getSetting, type ApprovalPolicy } from "@/server/lib/settings";
import { emit, audit, notify } from "@/server/lib/events";
import { publishToPlatform, sendEmail, replyToConversation } from "@/server/integrations/providers";

export type ActionType = "publish_content" | "send_email" | "send_reply";
export type ApprovalCategory = keyof Omit<ApprovalPolicy, "monthlyBudgetUsd"> | "content_review" | "workflow_gate";

const CATEGORY: Record<ActionType, ApprovalCategory> = {
  publish_content: "publishing",
  send_email: "external_communication",
  send_reply: "external_communication",
};

/** Email to external people ALWAYS needs explicit owner authorization, regardless of policy. */
const ALWAYS_APPROVE: ActionType[] = ["send_email"];

export async function executeAction(type: ActionType, params: Record<string, unknown>, actor: string): Promise<Record<string, unknown>> {
  switch (type) {
    case "publish_content": {
      const id = String(params.contentId);
      const item = await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, id) });
      if (!item) throw new Error("Content item not found");
      if (item.status === "published") return { alreadyPublished: true, externalId: item.externalId, url: item.externalUrl };
      if (!["approved", "scheduled", "failed", "publishing"].includes(item.status))
        throw new Error(`Content must be approved before publishing (status is "${item.status}")`);
      await db.update(schema.contentItems).set({ status: "publishing", updatedAt: new Date() }).where(eq(schema.contentItems.id, id));
      try {
        const r = await publishToPlatform(item);
        await db
          .update(schema.contentItems)
          .set({ status: "published", publishedAt: new Date(), externalId: r.externalId, externalUrl: r.url, publishError: null, updatedAt: new Date() })
          .where(eq(schema.contentItems.id, id));
        await emit("content.published", `Published “${item.title}” to ${item.platform}`, { data: { contentId: id, ...r } });
        await audit(actor, "content.published", id, r);
        return { published: true, ...r };
      } catch (e) {
        const msg = (e as Error).message;
        await db.update(schema.contentItems).set({ status: "failed", publishError: msg, updatedAt: new Date() }).where(eq(schema.contentItems.id, id));
        await emit("content.publish_failed", `Publishing “${item.title}” to ${item.platform} failed: ${msg}`, { data: { contentId: id } });
        await audit(actor, "content.publish_failed", id, { error: msg });
        throw e;
      }
    }
    case "send_email": {
      const r = await sendEmail({ to: String(params.to), subject: String(params.subject), text: String(params.body) });
      if (params.leadId) {
        const followUp = new Date(Date.now() + 3 * 86400_000);
        await db
          .update(schema.leads)
          .set({ stage: "contacted", lastContactAt: new Date(), nextFollowUpAt: followUp, updatedAt: new Date() })
          .where(eq(schema.leads.id, String(params.leadId)));
      }
      await emit("email.sent", `Email sent to ${params.to}: “${params.subject}”`, { data: { id: r.id } });
      await audit(actor, "email.sent", String(params.to), { subject: params.subject, id: r.id });
      return { sent: true, messageId: r.id };
    }
    case "send_reply": {
      const conv = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, String(params.conversationId)) });
      if (!conv) throw new Error("Conversation not found");
      if (!conv.externalId) throw new Error("Conversation has no external id — it was added manually; reply on the platform directly.");
      const r = await replyToConversation(conv.platform, conv.externalId, String(params.text));
      await db.update(schema.conversations).set({ status: "replied", draftReply: String(params.text) }).where(eq(schema.conversations.id, conv.id));
      await emit("community.replied", `Replied to ${conv.author} on ${conv.platform}`, { data: { id: r.id } });
      await audit(actor, "community.replied", conv.id, { id: r.id });
      return { replied: true, id: r.id };
    }
  }
}

export async function requestOrExecute(opts: {
  type: ActionType;
  params: Record<string, unknown>;
  title: string;
  summary: string;
  agentId: string;
  taskId?: string | null;
  risk?: "low" | "medium" | "high";
}): Promise<{ status: "executed"; result: Record<string, unknown> } | { status: "approval_requested"; approvalId: string }> {
  const category = CATEGORY[opts.type];
  const policy = await getSetting("approvalPolicy");
  const needsApproval = ALWAYS_APPROVE.includes(opts.type) || policy[category as keyof ApprovalPolicy] !== "auto";
  if (!needsApproval) {
    const result = await executeAction(opts.type, opts.params, `agent:${opts.agentId}`);
    return { status: "executed", result };
  }
  const approvalId = await createApproval({
    category,
    title: opts.title,
    summary: opts.summary,
    payload: opts.params,
    action: { type: opts.type, params: opts.params },
    risk: opts.risk ?? "medium",
    requestedBy: opts.agentId,
    taskId: opts.taskId ?? null,
  });
  return { status: "approval_requested", approvalId };
}

export async function createApproval(v: {
  category: string;
  title: string;
  summary: string;
  payload?: Record<string, unknown>;
  action?: { type: string; params: Record<string, unknown> } | null;
  risk?: string;
  requestedBy?: string | null;
  taskId?: string | null;
  workflowRunId?: string | null;
  workflowNodeId?: string | null;
}) {
  const [row] = await db
    .insert(schema.approvals)
    .values({
      category: v.category,
      title: v.title,
      summary: v.summary,
      payload: v.payload ?? {},
      action: v.action ?? null,
      risk: v.risk ?? "medium",
      requestedBy: v.requestedBy ?? null,
      taskId: v.taskId ?? null,
      workflowRunId: v.workflowRunId ?? null,
      workflowNodeId: v.workflowNodeId ?? null,
    })
    .returning({ id: schema.approvals.id });
  await emit("approval.requested", `Approval requested: ${v.title}`, { agentId: v.requestedBy, taskId: v.taskId, data: { approvalId: row.id } });
  await notify("approval", `Needs your approval: ${v.title}`, v.summary.slice(0, 280), "/approvals");
  return row.id;
}
