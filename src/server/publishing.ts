import { db, schema } from "@/db";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { createTask } from "@/server/tasks";

export const PUBLISHER_FOR: Record<string, string> = {
  tiktok: "tiktok-publisher",
  instagram: "instagram-publisher",
  youtube: "youtube-publisher",
  x: "x-publisher",
  linkedin: "x-publisher",
  newsletter: "newsletter-publisher",
};

/** Every 5 minutes: hand due scheduled content to the right publishing agent (one open task per agent). */
export async function queueDuePublishing() {
  const due = await db
    .select()
    .from(schema.contentItems)
    .where(and(eq(schema.contentItems.status, "scheduled"), lte(schema.contentItems.scheduledFor, new Date())));
  const byAgent = new Map<string, typeof due>();
  for (const c of due) {
    const a = PUBLISHER_FOR[c.platform];
    if (a) byAgent.set(a, [...(byAgent.get(a) ?? []), c]);
  }
  for (const [agentId, items] of byAgent) {
    const open = await db.query.tasks.findFirst({
      where: and(eq(schema.tasks.agentId, agentId), eq(schema.tasks.createdBy, "system:publishing"), inArray(schema.tasks.status, ["queued", "running", "blocked"])),
    });
    if (open) continue;
    const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, agentId) });
    if (!agent?.enabled) continue;
    await createTask({
      agentId,
      title: `Publish ${items.length} due item(s)`,
      instructions: `These scheduled content items are due now. Validate each one and publish it with publish_content:\n${items.map((i) => `- ${i.id} (${i.platform}/${i.format}): ${i.title}`).join("\n")}`,
      createdBy: "system:publishing",
      priority: 2,
      context: { contentIds: items.map((i) => i.id) },
    });
  }
  void sql;
}
