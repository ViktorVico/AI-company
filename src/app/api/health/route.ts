import { sql } from "@/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await sql`select 1`;
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }
}
