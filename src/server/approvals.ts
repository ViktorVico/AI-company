import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { executeAction, type ActionType } from "@/server/actions";
import { emit, audit } from "@/server/lib/events";
import { getBoss, QUEUES } from "@/server/queue";

export async function decideApproval(id: string, approved: boolean, note?: string) {
  const a = await db.query.approvals.findFirst({ where: eq(schema.approvals.id, id) });
  if (!a) throw new Error("Approval not found");
  if (a.status !== "pending") throw new Error(`Already ${a.status}`);
  await db
    .update(schema.approvals)
    .set({ status: approved ? "approved" : "rejected", decisionNote: note ?? null, decidedAt: new Date() })
    .where(eq(schema.approvals.id, id));
  await audit("owner", approved ? "approval.approved" : "approval.rejected", id, { title: a.title, note });
  await emit("approval.decided", `You ${approved ? "approved" : "rejected"}: ${a.title}`, { taskId: a.taskId, data: { approvalId: id, approved } });

  // Owner notes become company memory so agents learn the owner's preferences.
  if (note?.trim()) {
    await db.insert(schema.memories).values({
      scope: "company",
      kind: "preference",
      title: `Owner ${approved ? "approved" : "rejected"}: ${a.title}`.slice(0, 200),
      content: note.trim(),
      importance: 4,
      source: "owner",
    });
  }

  // Content review: approval moves the content forward.
  const contentId = (a.payload as { contentId?: string }).contentId;
  if (a.category === "content_review" && contentId) {
    await db
      .update(schema.contentItems)
      .set({ status: approved ? "approved" : "rejected", updatedAt: new Date() })
      .where(eq(schema.contentItems.id, contentId));
  }
  if (a.workflowRunId) {
    const { onApprovalDecided } = await import("@/server/workflows/engine");
    await onApprovalDecided(id, approved);
  }
  if (approved && a.action) {
    const boss = await getBoss();
    await boss.send(QUEUES.approvalExecute, { approvalId: id }, { retryLimit: 0 });
  }
}

/** Runs the approved external action (worker). Result is stored on the approval. */
export async function executeApproval(id: string) {
  const a = await db.query.approvals.findFirst({ where: eq(schema.approvals.id, id) });
  if (!a?.action || a.status !== "approved") return;
  try {
    const result = await executeAction(a.action.type as ActionType, a.action.params, "owner");
    await db.update(schema.approvals).set({ status: "executed", result }).where(eq(schema.approvals.id, id));
  } catch (e) {
    await db.update(schema.approvals).set({ status: "failed", result: { error: (e as Error).message } }).where(eq(schema.approvals.id, id));
    await emit("approval.failed", `Approved action failed: ${a.title} — ${(e as Error).message}`, { taskId: a.taskId });
  }
}
