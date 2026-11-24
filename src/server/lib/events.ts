import { appUrl } from "@/lib/app-url";
import { db, schema } from "@/db";

/** Records a real execution event for the live activity feed. */
export async function emit(
  type: string,
  message: string,
  opts: { agentId?: string | null; taskId?: string | null; data?: unknown } = {},
) {
  await db.insert(schema.events).values({
    type,
    message,
    agentId: opts.agentId ?? null,
    taskId: opts.taskId ?? null,
    data: (opts.data ?? null) as never,
  });
  if (TRIGGERABLE.includes(type)) {
    try {
      const { handleEvent } = await import("@/server/workflows/engine");
      await handleEvent(type, opts.data);
    } catch (e) {
      console.error("event trigger failed", e);
    }
  }
}

/** Event types workflows can be triggered by. */
export const TRIGGERABLE = [
  "content.published",
  "content.publish_failed",
  "task.failed",
  "approval.decided",
  "workflow.completed",
  "lead.created",
  "briefing.generated",
];

export async function audit(actor: string, action: string, target?: string | null, details?: unknown) {
  await db.insert(schema.auditLog).values({ actor, action, target: target ?? null, details: (details ?? null) as never });
}

export async function notify(kind: string, title: string, body?: string, href?: string) {
  await db.insert(schema.notifications).values({ kind, title, body: body ?? null, href: href ?? null });
  // Push to external channels when configured (best effort, never throws).
  try {
    const { sendSlack } = await import("@/server/integrations/providers");
    await sendSlack(`*${title}*${body ? `\n${body}` : ""}${href ? `\n${appUrl()}${href}` : ""}`, { silentIfMissing: true });
  } catch {
    /* ignore */
  }
}
