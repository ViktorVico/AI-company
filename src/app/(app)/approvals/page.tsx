import Link from "next/link";
import { db, schema } from "@/db";
import { desc, eq, inArray, ne } from "drizzle-orm";
import { AgentIcon } from "@/components/agent-icon";
import { Badge, Card, cx, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { DecisionBar } from "./decision";
import { dateTime, timeAgo } from "@/lib/format";

export const metadata = { title: "Approvals" };

const CAT: Record<string, string> = {
  content_review: "Content review",
  publishing: "Publishing",
  external_communication: "External communication",
  financial: "Financial",
  settings_change: "Settings change",
  irreversible: "Irreversible action",
  workflow_gate: "Workflow gate",
};

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view = "pending" } = await searchParams;
  const rows = await db
    .select()
    .from(schema.approvals)
    .where(view === "pending" ? eq(schema.approvals.status, "pending") : ne(schema.approvals.status, "pending"))
    .orderBy(desc(view === "pending" ? schema.approvals.createdAt : schema.approvals.decidedAt))
    .limit(100);
  const contentIds = rows.map((r) => (r.payload as { contentId?: string }).contentId).filter(Boolean) as string[];
  const content = contentIds.length ? await db.select().from(schema.contentItems).where(inArray(schema.contentItems.id, contentIds)) : [];
  const cmap = new Map(content.map((c) => [c.id, c]));
  const agents = await db.select({ id: schema.agents.id, name: schema.agents.name }).from(schema.agents);
  const aname = new Map(agents.map((a) => [a.id, a.name]));

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle="The company is autonomous, never uncontrolled. Anything external, sensitive or irreversible waits here for your decision — configure what needs approval in Settings."
      />
      <div className="mb-5 flex gap-1">
        {[
          ["pending", "Waiting for you"],
          ["history", "Decided"],
        ].map(([k, l]) => (
          <Link key={k} href={`?view=${k}`} className={cx("h-8 rounded-full px-3.5 text-[13px] leading-8", view === k ? "bg-ink text-white" : "text-ink-2 hover:bg-surface")}>
            {l}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty title={view === "pending" ? "Nothing is waiting for you" : "No decisions yet"}>
          {view === "pending" ? "When agents need permission to publish, send, or continue a workflow, it shows up here." : undefined}
        </Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((a) => {
            const c = cmap.get((a.payload as { contentId?: string }).contentId ?? "");
            const email = a.action?.type === "send_email" ? (a.action.params as { to: string; subject: string; body: string }) : null;
            return (
              <Card key={a.id} id={a.id} className="flex flex-col p-5 animate-rise">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge tone="dark">{CAT[a.category] ?? a.category}</Badge>
                  {a.risk === "high" && <Badge tone="bad">high risk</Badge>}
                  {a.risk === "medium" && <Badge tone="warn">medium risk</Badge>}
                  {a.status !== "pending" && <StatusBadge status={a.status} />}
                  <span className="ml-auto font-mono text-[10.5px] text-muted">{timeAgo(a.createdAt)}</span>
                </div>
                <h3 className="text-[16px] font-semibold tracking-tight">{a.title}</h3>
                {a.requestedBy && (
                  <div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted">
                    <AgentIcon id={a.requestedBy} className="size-3" /> requested by {aname.get(a.requestedBy) ?? a.requestedBy}
                    {a.taskId && (
                      <Link href={`/tasks/${a.taskId}`} className="underline underline-offset-2">
                        · see task
                      </Link>
                    )}
                    {a.workflowRunId && <span>· workflow gate</span>}
                  </div>
                )}

                {email ? (
                  <div className="mt-3 rounded-xl bg-sunken p-3 text-[12.5px]">
                    <div className="font-mono text-[11px] text-muted">To: {email.to}</div>
                    <div className="mt-1 font-medium">{email.subject}</div>
                    <div className="mt-2 whitespace-pre-wrap text-ink-2">{email.body}</div>
                  </div>
                ) : (
                  <p className="mt-3 whitespace-pre-wrap text-[13px] text-ink-2">{a.summary}</p>
                )}

                {c && (
                  <Link href={`/content/${c.id}`} className="mt-3 block rounded-xl border border-line p-3 transition hover:bg-sunken/60">
                    <div className="flex items-center gap-2 font-mono text-[10.5px] text-muted">
                      {c.platform} · {c.format}
                      {c.brandCheck && (
                        <Badge tone={c.brandCheck.passed ? "ok" : "bad"}>
                          brand {c.brandCheck.score ?? (c.brandCheck.passed ? "pass" : "fail")}
                        </Badge>
                      )}
                    </div>
                    {c.hook && <div className="mt-1 text-[14px] font-semibold">{c.hook}</div>}
                    <div className="mt-1 line-clamp-4 whitespace-pre-wrap text-[12.5px] text-ink-2">{c.caption || c.body || c.script}</div>
                    {c.assets.some((x) => x.kind === "image") && (
                      <div className="mt-2 flex gap-2">
                        {c.assets
                          .filter((x) => x.kind === "image")
                          .slice(0, 4)
                          .map((x) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={x.url} src={x.url} alt="" className="size-16 rounded-lg object-cover" />
                          ))}
                      </div>
                    )}
                  </Link>
                )}

                <div className="mt-auto pt-4">
                  {a.status === "pending" ? (
                    <DecisionBar id={a.id} />
                  ) : (
                    <div className="space-y-1 text-[12px] text-muted">
                      <div>
                        Decided {dateTime(a.decidedAt)}
                        {a.decisionNote && ` — “${a.decisionNote}”`}
                      </div>
                      {a.result != null && <pre className="scroll-thin max-h-28 overflow-auto rounded-lg bg-sunken p-2 font-mono text-[11px]">{JSON.stringify(a.result, null, 1)}</pre>}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
