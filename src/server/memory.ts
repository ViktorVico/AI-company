import { db, schema } from "@/db";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

const STOP = new Set("the a an and or of to in for on with our we is are be this that what how why who from by at as it".split(" "));

function terms(q: string) {
  return [...new Set(q.toLowerCase().split(/[^a-z0-9à-ÿ€$%]+/i).filter((t) => t.length > 2 && !STOP.has(t)))].slice(0, 8);
}

/** Keyword retrieval over the knowledge base and memories, ranked by term hits + importance. */
export async function searchKnowledge(query: string, opts: { category?: string; agentId?: string; limit?: number } = {}) {
  const ts = terms(query);
  const limit = opts.limit ?? 8;
  const docMatch = ts.length ? or(...ts.flatMap((t) => [ilike(schema.knowledgeDocs.title, `%${t}%`), ilike(schema.knowledgeDocs.content, `%${t}%`)])) : undefined;
  const docs = await db
    .select()
    .from(schema.knowledgeDocs)
    .where(and(opts.category ? eq(schema.knowledgeDocs.category, opts.category) : undefined, docMatch))
    .limit(50);
  const memMatch = ts.length ? or(...ts.flatMap((t) => [ilike(schema.memories.title, `%${t}%`), ilike(schema.memories.content, `%${t}%`)])) : undefined;
  const mems = await db
    .select()
    .from(schema.memories)
    .where(and(or(eq(schema.memories.scope, "company"), opts.agentId ? eq(schema.memories.agentId, opts.agentId) : sql`false`), memMatch))
    .orderBy(desc(schema.memories.importance), desc(schema.memories.createdAt))
    .limit(50);
  const score = (text: string) => ts.reduce((s, t) => s + (text.toLowerCase().split(t).length - 1), 0);
  const results = [
    ...docs.map((d) => ({ type: "document", category: d.category, title: d.title, content: d.content.slice(0, 3000), score: score(d.title + " " + d.content) + 2 })),
    ...mems.map((m) => ({ type: `${m.scope} memory (${m.kind})`, category: m.kind, title: m.title, content: m.content.slice(0, 1500), score: score(m.title + " " + m.content) + m.importance, at: m.createdAt })),
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return { query, results, note: results.length ? undefined : "Nothing found. The knowledge base may be missing this — say so rather than guessing." };
}

/** Compact always-on context injected into every agent's system prompt. */
export async function coreContext(agentId: string) {
  const docs = await db.select().from(schema.knowledgeDocs).where(or(eq(schema.knowledgeDocs.category, "objectives"), eq(schema.knowledgeDocs.category, "brand"), eq(schema.knowledgeDocs.category, "tone"), eq(schema.knowledgeDocs.category, "audience"), eq(schema.knowledgeDocs.category, "products")));
  const companyMem = await db
    .select()
    .from(schema.memories)
    .where(eq(schema.memories.scope, "company"))
    .orderBy(desc(schema.memories.importance), desc(schema.memories.createdAt))
    .limit(12);
  const agentMem = await db
    .select()
    .from(schema.memories)
    .where(and(eq(schema.memories.scope, "agent"), eq(schema.memories.agentId, agentId)))
    .orderBy(desc(schema.memories.createdAt))
    .limit(10);
  return { docs, companyMem, agentMem };
}
