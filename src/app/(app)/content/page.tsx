import Link from "next/link";
import { db, schema } from "@/db";
import { desc } from "drizzle-orm";
import { AgentIcon } from "@/components/agent-icon";
import { Badge, Card, cx, Empty, PageHeader } from "@/components/ui";
import { ObjectiveComposer } from "@/components/objective-composer";
import { timeAgo, dateTime } from "@/lib/format";
import { appTimezone } from "@/server/lib/settings";

export const metadata = { title: "Content" };

const COLS = [
  { id: "draft", label: "Drafts", match: ["draft"] },
  { id: "in_review", label: "In review", match: ["in_review"] },
  { id: "approved", label: "Approved", match: ["approved"] },
  { id: "scheduled", label: "Scheduled", match: ["scheduled", "publishing"] },
  { id: "published", label: "Published", match: ["published"] },
  { id: "failed", label: "Failed / rejected", match: ["failed", "rejected"] },
];
const PLATFORM: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", x: "X", linkedin: "LinkedIn", newsletter: "Newsletter" };

export default async function ContentPage() {
  const items = await db.select().from(schema.contentItems).orderBy(desc(schema.contentItems.updatedAt)).limit(300);
  const agents = await db.select({ id: schema.agents.id, name: schema.agents.name, department: schema.agents.department }).from(schema.agents);
  const tz = appTimezone();
  return (
    <div>
      <PageHeader title="Content" subtitle="Every asset from first concept to published post. Agents move work forward; you approve what goes out." />
      <div className="mb-6 max-w-3xl">
        <ObjectiveComposer title="Brief the Content department" direct agents={agents.filter((a) => a.department === "content" || a.id === "newsletter-publisher" || a.id === "poll-writer")} />
      </div>
      {items.length === 0 ? (
        <Empty title="No content yet">Brief the Visual Designer above, or enable the “Daily content engine” workflow.</Empty>
      ) : (
        <div className="scroll-thin -mx-4 flex gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          {COLS.map((col) => {
            const list = items.filter((i) => col.match.includes(i.status));
            return (
              <div key={col.id} className="w-[290px] shrink-0">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-[13px] font-semibold">{col.label}</span>
                  <span className="font-mono text-[11px] text-muted">{list.length}</span>
                </div>
                <div className="space-y-2.5">
                  {list.map((c) => {
                    const img = c.assets.find((a) => a.kind === "image");
                    return (
                      <Link key={c.id} href={`/content/${c.id}`}>
                        <Card className="overflow-hidden p-0 transition-shadow hover:shadow-[var(--shadow-float)]">
                          {img && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={img.url} alt="" className="aspect-[4/3] w-full object-cover" />
                          )}
                          <div className="p-3.5">
                            <div className="flex items-center gap-1.5">
                              <Badge tone="dark">{PLATFORM[c.platform] ?? c.platform}</Badge>
                              <Badge>{c.format}</Badge>
                              {c.brandCheck && <Badge tone={c.brandCheck.passed ? "ok" : "bad"}>brand {c.brandCheck.score ?? (c.brandCheck.passed ? "✓" : "✗")}</Badge>}
                            </div>
                            <div className="mt-2 line-clamp-2 text-[13.5px] font-semibold leading-snug">{c.hook || c.title}</div>
                            {c.hook && <div className="mt-0.5 line-clamp-1 text-[12px] text-muted">{c.title}</div>}
                            <div className={cx("mt-2 flex items-center justify-between font-mono text-[10.5px] text-muted")}>
                              <span className="flex items-center gap-1">
                                {c.createdByAgent && <AgentIcon id={c.createdByAgent} className="size-3" />}
                                {c.status === "scheduled" ? dateTime(c.scheduledFor, tz) : timeAgo(c.updatedAt)}
                              </span>
                              {c.status === "published" && Object.keys(c.metrics).length > 0 && <span>{Object.values(c.metrics).reduce((a, b) => a + Number(b || 0), 0)} eng.</span>}
                            </div>
                            {c.publishError && <div className="mt-1.5 line-clamp-2 text-[11.5px] text-bad">{c.publishError}</div>}
                          </div>
                        </Card>
                      </Link>
                    );
                  })}
                  {list.length === 0 && <div className="rounded-2xl border border-dashed border-line-2 py-6 text-center text-[12px] text-faint">empty</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
