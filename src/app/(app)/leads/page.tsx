import { db, schema } from "@/db";
import { desc, eq, sql } from "drizzle-orm";
import { Card, PageHeader } from "@/components/ui";
import { ObjectiveComposer } from "@/components/objective-composer";
import { LeadsTable } from "./client";

export const metadata = { title: "Leads" };

const STAGES = ["new", "qualified", "contacted", "replied", "meeting", "won", "lost"];

export default async function LeadsPage() {
  const leads = await db.select().from(schema.leads).orderBy(desc(schema.leads.updatedAt)).limit(500);
  const by = await db.select({ s: schema.leads.stage, c: sql<number>`count(*)` }).from(schema.leads).groupBy(schema.leads.stage);
  const agents = await db.select({ id: schema.agents.id, name: schema.agents.name, department: schema.agents.department }).from(schema.agents).where(eq(schema.agents.department, "sales"));
  return (
    <div>
      <PageHeader title="Leads" subtitle="The pipeline your Sales department maintains. Outreach is drafted by agents and only sent with your explicit authorization." />
      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ObjectiveComposer title="Brief the Sales department" direct agents={agents} />
        <Card className="grid grid-cols-4 gap-3 p-4 sm:grid-cols-7">
          {STAGES.map((s) => (
            <div key={s}>
              <div className="text-[11.5px] capitalize text-muted">{s}</div>
              <div className="text-[22px] font-semibold tabular">{Number(by.find((b) => b.s === s)?.c ?? 0)}</div>
            </div>
          ))}
        </Card>
      </div>
      <LeadsTable
        stages={STAGES}
        leads={leads.map((l) => ({ ...l, createdAt: l.createdAt.toISOString(), updatedAt: l.updatedAt.toISOString(), lastContactAt: l.lastContactAt?.toISOString() ?? null, nextFollowUpAt: l.nextFollowUpAt?.toISOString() ?? null }))}
      />
    </div>
  );
}
