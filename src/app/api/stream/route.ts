import { db, schema } from "@/db";
import { asc, desc, gt } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-Sent Events: pushes new execution events as they are written. Auth enforced by middleware. */
export async function GET(req: Request) {
  const enc = new TextEncoder();
  const last = await db.select({ id: schema.events.id }).from(schema.events).orderBy(desc(schema.events.id)).limit(1);
  let cursor = Number(new URL(req.url).searchParams.get("after")) || last[0]?.id || 0;
  let closed = false;
  req.signal.addEventListener("abort", () => (closed = true));

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(enc.encode(`retry: 3000\n\n`));
      let beat = 0;
      while (!closed) {
        try {
          const rows = await db.select().from(schema.events).where(gt(schema.events.id, cursor)).orderBy(asc(schema.events.id)).limit(50);
          for (const r of rows) {
            cursor = r.id;
            controller.enqueue(enc.encode(`id: ${r.id}\ndata: ${JSON.stringify(r)}\n\n`));
          }
          if (++beat % 15 === 0) controller.enqueue(enc.encode(`: ping\n\n`));
        } catch {
          /* transient db error — keep the stream open */
        }
        await new Promise((r) => setTimeout(r, 1200));
      }
      try {
        controller.close();
      } catch {}
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
