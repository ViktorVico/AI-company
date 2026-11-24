import { readMedia } from "@/server/lib/storage";

export const runtime = "nodejs";

// Public by design (unguessable 128-bit names) so social platforms can fetch media for publishing.
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  try {
    const m = await readMedia(name);
    if (!m) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(m.data), { headers: { "content-type": m.contentType, "cache-control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
