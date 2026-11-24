import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "aic_session";
const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET || "");

export async function signSession() {
  if ((process.env.SESSION_SECRET || "").length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new SignJWT({ role: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifySession(token?: string) {
  if (!token || (process.env.SESSION_SECRET || "").length < 32) return false;
  try {
    await jwtVerify(token, secret());
    return true;
  } catch {
    return false;
  }
}
