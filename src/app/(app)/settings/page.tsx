import { db, schema } from "@/db";
import { desc } from "drizzle-orm";
import { getSetting, appTimezone } from "@/server/lib/settings";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { SettingsForms } from "./client";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [policy, profile, briefing] = await Promise.all([getSetting("approvalPolicy"), getSetting("businessProfile"), getSetting("briefing")]);
  const auditRows = await db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.id)).limit(60);
  const tz = appTimezone();
  return (
    <div>
      <PageHeader title="Settings" subtitle="Who you are, what needs your approval, and when your morning page arrives." />
      <SettingsForms policy={policy} profile={profile} briefing={briefing} timezone={tz} />
      <Card className="mt-6 p-5">
        <SectionTitle right={<span className="font-mono text-[11px] text-muted">every change is traceable</span>}>Audit log</SectionTitle>
        {auditRows.length === 0 ? (
          <div className="text-[13px] text-muted">No audited actions yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12.5px]">
              <tbody>
                {auditRows.map((a) => (
                  <tr key={a.id} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pr-3 font-mono text-[11px] text-muted">{dateTime(a.createdAt, tz)}</td>
                    <td className="py-2 pr-3 font-mono text-[11px]">{a.actor}</td>
                    <td className="py-2 pr-3 font-medium">{a.action}</td>
                    <td className="max-w-[340px] truncate py-2 font-mono text-[11px] text-muted">
                      {a.target} {a.details ? JSON.stringify(a.details).slice(0, 160) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
