import fs from "node:fs/promises";
import { storedPath } from "@/server/lib/storage";

export const runtime = "nodejs";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp3: "audio/mpeg", mp4: "video/mp4", wav: "audio/wav" };

// Public by design (unguessable 128-bit names) so social platforms can fetch media for publishing.
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  try {
    const buf = await fs.readFile(storedPath(name));
    const ext = name.split(".").pop()!.toLowerCase();
    return new Response(new Uint8Array(buf), { headers: { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
