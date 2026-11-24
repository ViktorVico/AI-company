import crypto from "node:crypto";

function key(): Buffer {
  const k = process.env.ENCRYPTION_KEY ?? "";
  // 64 hex chars are used as-is; any other secret of 32+ chars (e.g. a generated base64 value) is hashed to 32 bytes.
  if (/^[0-9a-f]{64}$/i.test(k)) return Buffer.from(k, "hex");
  if (k.length >= 32) return crypto.createHash("sha256").update(k).digest();
  throw new Error("ENCRYPTION_KEY must be set (64 hex chars, or any random secret of 32+ characters) to store credentials.");
}

/** AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}
