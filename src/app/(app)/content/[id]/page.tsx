import Link from "next/link";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { desc, eq, sql } from "drizzle-orm";
import { Badge, Card, PageHeader, SectionTitle, StatusBadge } from "@/components/ui";
import { ContentEditor, ContentActions } from "./client";
import { dateTime } from "@/lib/format";
import { isConfigured } from "@/server/integrations/registry";
import { PLATFORM_INTEGRATION } from "@/server/integrations/providers";
import { appTimezone } from "@/server/lib/settings";

export const metadata = { title: "Content item" };

export default async function ContentItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const c = await db.query.contentItems.findFirst({ where: eq(schema.contentItems.id, id) });
  if (!c) notFound();
  const approvals = await db.select().from(schema.approvals).where(sql`${schema.approvals.payload}->>'contentId' = ${id}`).orderBy(desc(schema.approvals.createdAt));
  const agent = c.createdByAgent ? await db.query.agents.findFirst({ where: eq(schema.agents.id, c.createdByAgent), columns: { name: true } }) : null;
  const connected = await isConfigured(PLATFORM_INTEGRATION[c.platform] ?? "");
  const tz = appTimezone();

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Link href="/content" className="hover:text-ink">
              Content
            </Link>
            <span>/</span>
            <span>
              {c.platform} · {c.format}
            </span>
          </>
        }
        title={<span className="text-[28px] sm:text-[34px]">{c.title}</span>}
        actions={<StatusBadge status={c.status} />}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <ContentEditor
          item={{ id: c.id, title: c.title, hook: c.hook ?? "", caption: c.caption ?? "", script: c.script ?? "", body: c.body ?? "", productionNotes: c.productionNotes ?? "", hashtags: c.hashtags, assets: c.assets }}
          locked={["published", "publishing"].includes(c.status)}
        />
        <div className="space-y-6">
          <ContentActions id={c.id} status={c.status} connected={connected} platform={c.platform} scheduledFor={c.scheduledFor?.toISOString() ?? null} />
          <Card className="space-y-2 p-5 text-[13px]">
            <SectionTitle>Details</SectionTitle>
            <div className="flex justify-between">
              <span className="text-muted">Created by</span>
              <span>{agent?.name ?? "owner"}</span>
            </div>
            {c.taskId && (
              <div className="flex justify-between">
                <span className="text-muted">Task</span>
                <Link className="underline" href={`/tasks/${c.taskId}`}>
                  open
                </Link>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted">Scheduled</span>
              <span>{dateTime(c.scheduledFor, tz)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Published</span>
              <span>{dateTime(c.publishedAt, tz)}</span>
            </div>
            {c.externalUrl && (
              <a className="block truncate text-accent-strong underline" href={c.externalUrl} target="_blank" rel="noreferrer">
                {c.externalUrl}
              </a>
            )}
            {c.publishError && <div className="rounded-lg bg-bad-soft p-2 text-[12px] text-bad">{c.publishError}</div>}
          </Card>
          {c.brandCheck && (
            <Card className="p-5">
              <SectionTitle right={<Badge tone={c.brandCheck.passed ? "ok" : "bad"}>{c.brandCheck.passed ? "passed" : "needs work"} {c.brandCheck.score != null && `· ${c.brandCheck.score}`}</Badge>}>Brand Guardian</SectionTitle>
              <p className="whitespace-pre-wrap text-[12.5px] text-ink-2">{c.brandCheck.notes}</p>
            </Card>
          )}
          {Object.keys(c.metrics).length > 0 && (
            <Card className="p-5">
              <SectionTitle right={<span className="font-mono text-[10.5px] text-muted">{dateTime(c.metricsUpdatedAt, tz)}</span>}>Engagement</SectionTitle>
              <dl className="grid grid-cols-2 gap-3">
                {Object.entries(c.metrics).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11.5px] text-muted">{k.replace(/_/g, " ")}</dt>
                    <dd className="text-[18px] font-semibold tabular">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
          {approvals.length > 0 && (
            <Card className="p-5">
              <SectionTitle>Approval trail</SectionTitle>
              <ul className="space-y-2 text-[12.5px]">
                {approvals.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{a.title}</span>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
