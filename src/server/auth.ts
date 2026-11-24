import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/** Defence in depth: every server action re-checks the session (middleware alone is not enough). */
export async function requireOwner() {
  const c = await cookies();
  if (!(await verifySession(c.get(SESSION_COOKIE)?.value))) throw new Error("Unauthorized");
}
