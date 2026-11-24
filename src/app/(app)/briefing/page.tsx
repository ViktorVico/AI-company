import Link from "next/link";
import { db, schema } from "@/db";
import { desc, eq } from "drizzle-orm";
import { getSetting, appTimezone } from "@/server/lib/settings";
import type { BriefingData } from "@/server/briefing";
import { AgentIcon } from "@/components/agent-icon";
import { Asterisk, Badge, Card, cx, Empty, LinkButton } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { decide, generateBriefingNow } from "@/app/actions";
import { clock, timeAgo } from "@/lib/format";

export const metadata = { title: "Morning page" };

const PLATFORM: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", x: "X", linkedin: "LinkedIn", newsletter: "Newsletter" };

function Row({ left, title, sub, right }: { left?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      {left && <span className="w-12 shrink-0 font-mono text-[13px] tabular">{left}</span>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium">{title}</div>
        {sub && <div className="truncate text-[12px] text-muted">{sub}</div>}
      </div>
      {right && <div className="shrink-0 text-[12.5px] text-muted">{right}</div>}
    </div>
  );
}

export default async function BriefingPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const list = await db.select({ id: schema.briefings.id, forDate: schema.briefings.forDate, createdAt: schema.briefings.createdAt }).from(schema.briefings).orderBy(desc(schema.briefings.id)).limit(14);
  const b = id ? await db.query.briefings.findFirst({ where: eq(schema.briefings.id, Number(id)) }) : await db.query.briefings.findFirst({ orderBy: desc(schema.briefings.id) });
  const profile = await getSetting("businessProfile");
  const settings = await getSetting("briefing");
  const tz = appTimezone();

  if (!b)
    return (
      <div className="mx-auto max-w-2xl pt-6">
        <Empty
          title="No briefing yet"
          action={
            <ActionButton variant="primary" fn={generateBriefingNow} args={[false]}>
              Generate today's briefing
            </ActionButton>
          }
        >
          Your morning page is generated automatically every day at {settings.time} ({tz}) from real system data. You can also generate one now.
        </Empty>
      </div>
    );

  const d = b.data as unknown as BriefingData;
  const h = d.happened;
  const date = new Date(b.createdAt);
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: tz }).format(date);
  const pendingNow = await db.select().from(schema.approvals).where(eq(schema.approvals.status, "pending")).orderBy(desc(schema.approvals.createdAt)).limit(6);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,720px)_1fr]">
      <div className="space-y-6">
        <Card className="p-6 sm:p-8 animate-rise">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[13px] text-muted">
              <Asterisk className="size-3.5 text-accent" /> Morning page
            </span>
            <span className="font-mono text-[12px] text-muted">
              {weekday} {clock(date, tz)}
            </span>
          </div>
          <h1 className="display mt-3 text-[40px] sm:text-[52px]">Good morning{profile.ownerName ? `, ${profile.ownerName.split(" ")[0]}` : ""}.</h1>
          {b.narrative && <p className="mt-4 text-[15px] leading-relaxed text-ink-2">{b.narrative}</p>}

          {/* What happened */}
          <div className="mt-8">
            <div className="mb-3 text-[12px] font-medium text-muted">What happened · last 24h</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Opportunities", h.opportunities],
                ["Content created", h.contentCreated],
                ["Published", h.published],
                ["Qualified leads", h.leadsQualified],
              ].map(([l, v]) => (
                <div key={l as string} className="rounded-2xl bg-sunken px-4 py-3">
                  <div className="text-[26px] font-semibold tracking-tight tabular">{v}</div>
                  <div className="text-[12px] text-muted">{l}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 font-mono text-[11px] text-muted">
              {h.tasksCompleted} tasks completed · {h.tasksFailed} failed · {h.leadsNew} new leads · ${h.costUsd} AI spend
            </div>
            <div className="mt-4 space-y-3">
              {Object.entries(h.byDepartment)
                .filter(([, v]) => v.completed > 0)
                .map(([k, v]) => (
                  <div key={k}>
                    <div className="text-[13px] font-semibold">
                      {v.name} <span className="font-mono text-[11px] font-normal text-muted">{v.completed} done</span>
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {v.highlights.map((x) => (
                        <li key={x.taskId}>
                          <Link href={`/tasks/${x.taskId}`} className="block truncate text-[13px] text-ink-2 hover:text-ink">
                            <span className="text-muted">{x.agent}:</span> {x.summary}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </div>

          {/* What worked */}
          <div className="mt-8">
            <div className="mb-2 text-[12px] font-medium text-muted">What worked</div>
            {d.worked.bestContent.length === 0 && d.worked.bestWork.length === 0 && d.worked.qualifiedLeads.length === 0 ? (
              <div className="text-[13px] text-muted">No performance data yet — engagement appears once content is published through connected platforms.</div>
            ) : (
              <div className="space-y-2">
                {d.worked.bestContent.map((c) => (
                  <a key={c.id} href={c.url ?? `/content/${c.id}`} className="flex items-center justify-between gap-3 rounded-2xl bg-sunken px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-semibold">{c.title}</div>
                      <div className="truncate text-[12px] text-muted">
                        {PLATFORM[c.platform]} ·{" "}
                        {Object.entries(c.metrics)
                          .slice(0, 3)
                          .map(([k, v]) => `${v} ${k.replace(/_count|Count/g, "")}`)
                          .join(", ")}
                      </div>
                    </div>
                  </a>
                ))}
                {d.worked.qualifiedLeads.map((l) => (
                  <Row key={l.id} title={`${l.name}${l.company ? ` · ${l.company}` : ""}`} sub={l.reason} right={l.score != null && <Badge tone="accent">score {l.score}</Badge>} />
                ))}
                {d.worked.bestWork.map((w) => (
                  <Row key={w.taskId} title={<Link href={`/tasks/${w.taskId}`}>{w.summary}</Link>} sub={w.agent} right={<Badge tone="ok">QC {w.score}</Badge>} />
                ))}
              </div>
            )}
          </div>

          {/* Today */}
          <div className="mt-8">
            <div className="mb-2 text-[12px] font-medium text-muted">Today's schedule</div>
            {d.today.publications.length + d.today.workflows.length + d.today.followUps.length === 0 ? (
              <div className="text-[13px] text-muted">Nothing scheduled. {d.today.queuedTasks ? `${d.today.queuedTasks} tasks are queued.` : ""}</div>
            ) : (
              <div className="divide-y divide-line/70">
                {d.today.publications.map((p) => (
                  <Row key={p.id} left={clock(p.at, tz)} title={<Link href={`/content/${p.id}`}>{p.title}</Link>} right={PLATFORM[p.platform]} />
                ))}
                {d.today.workflows.map((w) => (
                  <Row key={w.id} left={clock(w.next, tz)} title={<Link href={`/workflows/${w.id}`}>{w.name}</Link>} right="workflow" />
                ))}
                {d.today.followUps.map((f) => (
                  <Row key={f.id} left={clock(f.at, tz)} title={f.name} sub={f.company} right="follow-up" />
                ))}
              </div>
            )}
          </div>

          {/* Attention */}
          <div className="mt-8">
            <div className="mb-1 text-[12px] font-medium text-muted">Next</div>
            <div className="mb-2 text-[17px] font-semibold tracking-tight">
              {pendingNow.length ? `${pendingNow.length} ${pendingNow.length === 1 ? "decision" : "decisions"} waiting for you` : "Nothing waiting for you"}
            </div>
            <div className="space-y-1">
              {pendingNow.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 py-1">
                  <Link href={`/approvals#${a.id}`} className="min-w-0 truncate text-[13.5px]">
                    {a.title}
                  </Link>
                  <ActionButton size="sm" variant="outline" fn={decide} args={[a.id, true]}>
                    Approve
                  </ActionButton>
                </div>
              ))}
            </div>
            {(d.attention.failedTasks.length > 0 || d.attention.escalations.length > 0 || d.attention.agents.length > 0) && (
              <div className="mt-4 space-y-1.5 rounded-2xl bg-bad-soft/60 p-4 text-[13px]">
                {d.attention.failedTasks.map((t) => (
                  <Link key={t.id} href={`/tasks/${t.id}`} className="block truncate">
                    <span className="text-bad">Failed:</span> {t.agent} — {t.title}
                  </Link>
                ))}
                {d.attention.escalations.map((c) => (
                  <Link key={c.id} href="/community" className="block truncate">
                    <span className="text-bad">Escalated:</span> {c.author} on {c.platform} — “{c.text}”
                  </Link>
                ))}
                {d.attention.agents.map((a) => (
                  <Link key={a.id} href={`/agents/${a.id}`} className="flex items-center gap-1.5">
                    <AgentIcon id={a.id} className="size-3" /> {a.name} needs attention
                  </Link>
                ))}
              </div>
            )}
            {d.attention.disconnected.length > 0 && (
              <div className="mt-3 text-[12px] text-muted">
                Not connected: {d.attention.disconnected.join(", ")}.{" "}
                <Link href="/integrations" className="underline">
                  Connect
                </Link>
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="p-5">
          <div className="text-[13px] font-semibold">Delivery</div>
          <p className="mt-1 text-[12.5px] text-muted">
            {settings.enabled ? `Generated daily at ${settings.time} (${tz}) and delivered via ${settings.channels.join(", ")}.` : "Automatic briefing is off."} {b.deliveredVia.length ? `This one was delivered via ${b.deliveredVia.join(", ")}.` : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton variant="primary" size="sm" fn={generateBriefingNow} args={[false]}>
              Regenerate now
            </ActionButton>
            <ActionButton variant="secondary" size="sm" fn={generateBriefingNow} args={[true]}>
              Generate & deliver
            </ActionButton>
            <LinkButton href="/settings" size="sm" variant="ghost">
              Schedule →
            </LinkButton>
          </div>
        </Card>
        <Card className="p-5">
          <div className="mb-2 text-[13px] font-semibold">Previous briefings</div>
          <ul className="space-y-0.5">
            {list.map((x) => (
              <li key={x.id}>
                <Link href={`/briefing?id=${x.id}`} className={cx("flex justify-between rounded-lg px-2 py-1.5 text-[13px]", x.id === b.id ? "bg-sunken font-medium" : "hover:bg-sunken/60")}>
                  <span>{x.forDate}</span>
                  <span className="font-mono text-[11px] text-muted">{timeAgo(x.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
