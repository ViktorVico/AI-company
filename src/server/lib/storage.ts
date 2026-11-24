import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || "storage");

/** Stores a generated/uploaded file and returns its public path (/media/<random>.<ext>). */
export async function saveFile(buf: Buffer, ext: string): Promise<{ url: string; bytes: number }> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  const name = `${crypto.randomBytes(16).toString("hex")}.${ext.replace(/[^a-z0-9]/gi, "")}`;
  await fs.writeFile(path.join(STORAGE_DIR, name), buf);
  return { url: `/media/${name}`, bytes: buf.length };
}

export function storedPath(urlOrName: string) {
  const name = path.basename(urlOrName);
  if (!/^[a-f0-9]{32}\.[a-z0-9]+$/i.test(name)) throw new Error("Invalid media name");
  return path.join(STORAGE_DIR, name);
}

export async function readStoredFile(url: string) {
  return fs.readFile(storedPath(url));
}
