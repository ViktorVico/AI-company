import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export const MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
};

/** Stores a generated file in Postgres and returns its public path (/media/<random>.<ext>). */
export async function saveFile(buf: Buffer, ext: string): Promise<{ url: string; bytes: number }> {
  const clean = ext.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const name = `${crypto.randomBytes(16).toString("hex")}.${clean}`;
  await db.insert(schema.media).values({ name, contentType: MEDIA_TYPES[clean] ?? "application/octet-stream", data: buf });
  return { url: `/media/${name}`, bytes: buf.length };
}

export function mediaName(urlOrName: string) {
  const name = urlOrName.split("/").pop() ?? "";
  if (!/^[a-f0-9]{32}\.[a-z0-9]+$/i.test(name)) throw new Error("Invalid media name");
  return name;
}

export async function readMedia(urlOrName: string) {
  return db.query.media.findFirst({ where: eq(schema.media.name, mediaName(urlOrName)) });
}

export async function readStoredFile(url: string): Promise<Buffer> {
  const m = await readMedia(url);
  if (!m) throw new Error(`Media ${url} not found`);
  return m.data;
}
