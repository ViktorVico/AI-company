import Link from "next/link";
import { db, schema } from "@/db";
import { desc, eq, sql } from "drizzle-orm";
import { Badge, Card, cx, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { ObjectiveComposer } from "@/components/objective-composer";
import { AddConversation, ReplyBox } from "./client";
import { timeAgo } from "@/lib/format";

export const metadata = { title: "Community" };

export default async function CommunityPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = "open" } = await searchParams;
  const rows = await db
    .select()
    .from(schema.conversations)
    .where(status === "all" ? undefined : eq(schema.conversations.status, status))
    .orderBy(desc(schema.conversations.createdAt))
    .limit(150);
  const counts = await db.select({ s: schema.conversations.status, c: sql<number>`count(*)` }).from(schema.conversations).groupBy(schema.conversations.status);
  const sentiment = await db.select({ s: schema.conversations.sentiment, c: sql<number>`count(*)` }).from(schema.conversations).groupBy(schema.conversations.sentiment);
  const agents = await db.select({ id: schema.agents.id, name: schema.agents.name, department: schema.agents.department }).from(schema.agents).where(eq(schema.agents.department, "community"));
  const n = (s: string) => Number(counts.find((c) => c.s === s)?.c ?? 0);
  const total = sentiment.reduce((a, b) => a + Number(b.c), 0);

  return (
    <div>
      <PageHeader title="Community" subtitle="Comments, mentions and DMs pulled from connected platforms. Agents triage and draft; replies follow your approval policy, escalations always come to you." />
      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <ObjectiveComposer title="Brief the Community department" direct agents={agents} />
        <Card className="p-4">
          <div className="text-[13px] font-semibold">Sentiment</div>
          {total === 0 ? (
            <div className="mt-2 text-[12.5px] text-muted">No conversations classified yet.</div>
          ) : (
            <>
              <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-sunken">
                {(["positive", "neutral", "negative"] as const).map((k) => {
                  const v = Number(sentiment.find((x) => x.s === k)?.c ?? 0);
                  return <div key={k} className={cx(k === "positive" ? "bg-ok" : k === "negative" ? "bg-bad" : "bg-faint")} style={{ width: `${(v / total) * 100}%` }} />;
                })}
              </div>
              <div className="mt-2 flex gap-4 text-[12px] text-muted">
                {(["positive", "neutral", "negative", null] as const).map((k) => (
                  <span key={String(k)}>
                    {k ?? "unclassified"} <b className="text-ink">{Number(sentiment.find((x) => x.s === k)?.c ?? 0)}</b>
                  </span>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto">
          {["open", "drafted", "escalated", "replied", "closed", "all"].map((s) => (
            <Link key={s} href={`?status=${s}`} className={cx("h-8 shrink-0 rounded-full px-3 text-[12.5px] leading-8", status === s ? "bg-ink text-white" : "text-ink-2 hover:bg-surface")}>
              {s} {s !== "all" && <span className="opacity-60">{n(s)}</span>}
            </Link>
          ))}
        </div>
        <AddConversation />
      </div>
      {rows.length === 0 ? (
        <Empty title="No conversations here">Connect X, Instagram or YouTube and the Comment Monitor pulls new comments and mentions in. You can also add one manually.</Empty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-semibold">{c.author}</span>
                <Badge>{c.platform}</Badge>
                <Badge>{c.kind}</Badge>
                {c.sentiment && <Badge tone={c.sentiment === "positive" ? "ok" : c.sentiment === "negative" ? "bad" : "neutral"}>{c.sentiment}</Badge>}
                {c.priority && c.priority !== "normal" && <Badge tone={c.priority === "escalate" || c.priority === "high" ? "bad" : "neutral"}>{c.priority}</Badge>}
                {c.isLeadSignal && <Badge tone="accent">lead signal</Badge>}
                <span className="ml-auto flex items-center gap-2">
                  <span className="font-mono text-[10.5px] text-muted">{timeAgo(c.createdAt)}</span>
                  <StatusBadge status={c.status} />
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[13.5px]">{c.text}</p>
              <ReplyBox id={c.id} draft={c.draftReply ?? ""} canSend={!!c.externalId && c.status !== "replied"} status={c.status} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
