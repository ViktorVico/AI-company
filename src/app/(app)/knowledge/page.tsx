import { db, schema } from "@/db";
import { desc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/ui";
import { KnowledgeBase } from "./client";
import { MemoryPanel } from "../agents/[id]/client";

export const metadata = { title: "Knowledge" };

export default async function KnowledgePage() {
  const docs = await db.select().from(schema.knowledgeDocs).orderBy(desc(schema.knowledgeDocs.updatedAt));
  const mems = await db.select().from(schema.memories).where(eq(schema.memories.scope, "company")).orderBy(desc(schema.memories.importance), desc(schema.memories.createdAt)).limit(100);
  return (
    <div className="space-y-10">
      <div>
        <PageHeader
          title="Knowledge"
          subtitle="What the company knows. Objectives, brand, audience, tone and products are injected into every agent's context; everything else is searchable with the search_knowledge tool."
        />
        <KnowledgeBase docs={docs.map((d) => ({ id: d.id, category: d.category, title: d.title, content: d.content, fileName: d.fileName, updatedAt: d.updatedAt.toISOString() }))} />
      </div>
      <div>
        <h2 className="display mb-1 text-[26px]">Company memory</h2>
        <p className="mb-5 text-[13.5px] text-muted">Durable decisions, insights and preferences written by the Memory Manager, other permitted agents, and your approval notes.</p>
        <MemoryPanel agentId={null} memories={mems.map((m) => ({ id: m.id, kind: m.kind, title: m.title, content: m.content, importance: m.importance, source: m.source, createdAt: m.createdAt.toISOString() }))} />
      </div>
    </div>
  );
}
