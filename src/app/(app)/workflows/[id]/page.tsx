import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import { asc, desc, eq } from "drizzle-orm";
import { nextRuns } from "@/server/workflows/engine";
import { TRIGGERABLE } from "@/server/lib/events";
import { appTimezone } from "@/server/lib/settings";
import { Builder } from "./builder";

export const metadata = { title: "Workflow builder" };

export default async function WorkflowPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ run?: string }> }) {
  const { id } = await params;
  const { run: runParam } = await searchParams;
  const isNew = id === "new";
  const wf = isNew ? null : /^[0-9a-f-]{36}$/.test(id) ? await db.query.workflows.findFirst({ where: eq(schema.workflows.id, id) }) : null;
  if (!isNew && !wf) notFound();
  const agents = await db.select({ id: schema.agents.id, name: schema.agents.name, department: schema.agents.department, role: schema.agents.role }).from(schema.agents).orderBy(asc(schema.agents.sortOrder));
  const runs = wf ? await db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.workflowId, wf.id)).orderBy(desc(schema.workflowRuns.startedAt)).limit(25) : [];
  const runId = runParam ?? runs[0]?.id;
  const steps = runId ? await db.select().from(schema.workflowStepRuns).where(eq(schema.workflowStepRuns.runId, runId)) : [];

  return (
    <Builder
      key={wf?.id ?? "new"}
      workflow={
        wf
          ? { id: wf.id, name: wf.name, description: wf.description, enabled: wf.enabled, triggerType: wf.triggerType, schedule: wf.schedule, eventType: wf.eventType, nodes: wf.nodes, edges: wf.edges }
          : {
              id: null,
              name: "Untitled workflow",
              description: "",
              enabled: false,
              triggerType: "manual",
              schedule: "0 6 * * *",
              eventType: null,
              nodes: [{ id: "trigger", type: "trigger", position: { x: 200, y: 20 }, data: { label: "Start" } }],
              edges: [],
            }
      }
      agents={agents}
      events={TRIGGERABLE}
      nextRuns={wf?.schedule ? nextRuns(wf.schedule, 3).map((d) => d.toISOString()) : []}
      timezone={appTimezone()}
      runs={runs.map((r) => ({ id: r.id, status: r.status, trigger: r.trigger, startedAt: r.startedAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null, error: r.error }))}
      selectedRun={runId ?? null}
      steps={steps.map((s) => ({ nodeId: s.nodeId, status: s.status, taskId: s.taskId, approvalId: s.approvalId, branch: s.branch, error: s.error }))}
    />
  );
}
