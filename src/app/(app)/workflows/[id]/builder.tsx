"use client";

import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  addEdge,
  useEdgesState,
  useNodesState,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Bot, GitBranch, Hand, Timer, Trash2, Play, Pause } from "lucide-react";
import { AgentIcon } from "@/components/agent-icon";
import { Asterisk, Badge, Button, Card, cx, Field, inputClass, SectionTitle, StatusBadge, textareaClass } from "@/components/ui";
import { saveWorkflow, setWorkflowEnabled, runWorkflowNow, deleteWorkflow, cancelWorkflowRun } from "@/app/actions";
import { CRON_PRESETS, describeCron } from "@/lib/cron";
import { timeAgo, dateTime } from "@/lib/format";

type NodeData = {
  label?: string;
  agentId?: string;
  instructions?: string;
  mode?: string;
  field?: string;
  value?: string;
  title?: string;
  minutes?: number;
  _agentName?: string;
  _status?: string;
  _branch?: string | null;
  _taskId?: string | null;
};
type WFNode = { id: string; type: "trigger" | "agent" | "condition" | "approval" | "delay"; position: { x: number; y: number }; data: NodeData };
type WF = {
  id: string | null;
  name: string;
  description: string;
  enabled: boolean;
  triggerType: string;
  schedule: string | null;
  eventType: string | null;
  nodes: WFNode[];
  edges: { id: string; source: string; target: string; sourceHandle?: string | null }[];
};
type AgentOpt = { id: string; name: string; department: string; role: string };
type Step = { nodeId: string; status: string; taskId: string | null; approvalId: string | null; branch: string | null; error: string | null };
type Run = { id: string; status: string; trigger: string; startedAt: string; completedAt: string | null; error: string | null };

const ring = (s?: string) =>
  s === "running" ? "ring-2 ring-accent shadow-[0_0_0_6px_rgba(217,119,87,0.12)]" : s === "completed" ? "ring-2 ring-ok/70" : s === "failed" ? "ring-2 ring-bad" : s === "waiting" ? "ring-2 ring-warn" : s === "skipped" ? "opacity-45" : "";

function StepStatus({ d }: { d: NodeData }) {
  if (!d._status || d._status === "pending") return null;
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <StatusBadge status={d._status} />
      {d._branch && <span className="font-mono text-[10px] text-muted">→ {d._branch}</span>}
    </div>
  );
}

function TriggerNode({ data, selected }: NodeProps<Node<NodeData>>) {
  return (
    <div className={cx("flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[12.5px] font-medium text-white shadow-[var(--shadow-float)]", selected && "ring-2 ring-accent")}>
      <Asterisk className="size-3.5 text-accent" />
      {data.label || "Start"}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function AgentNode({ data, selected }: NodeProps<Node<NodeData>>) {
  return (
    <div className={cx("w-[230px] rounded-2xl bg-white p-3 shadow-[var(--shadow-card)] transition", selected && "ring-2 ring-ink", ring(data._status))}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2">
        <span className={cx("grid size-7 place-items-center rounded-lg", data._status === "running" ? "bg-accent-soft text-accent-strong" : "bg-accent-softer")}>
          {data.agentId ? <AgentIcon id={data.agentId} className="size-3.5" /> : <Bot className="size-3.5" />}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-semibold">{data.label || data._agentName || "Agent step"}</div>
          <div className="truncate font-mono text-[10px] text-muted">{data._agentName ?? "choose an agent"}</div>
        </div>
      </div>
      {data.instructions && <div className="mt-2 line-clamp-2 text-[11px] text-muted">{data.instructions}</div>}
      <StepStatus d={data} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function ConditionNode({ data, selected }: NodeProps<Node<NodeData>>) {
  const desc =
    data.mode === "data_gte" ? `${data.field} ≥ ${data.value}` : data.mode === "data_lte" ? `${data.field} ≤ ${data.value}` : data.mode === "not_contains" ? `output lacks “${data.value}”` : data.mode === "status" ? `status is ${data.value || "completed"}` : `output has “${data.value ?? ""}”`;
  return (
    <div className={cx("w-[200px] rounded-2xl border border-dashed border-ink/40 bg-white/90 p-3", selected && "ring-2 ring-ink", ring(data._status))}>
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2 text-[12px] font-semibold">
        <GitBranch className="size-3.5" /> {data.label || "If"}
      </div>
      <div className="mt-1 font-mono text-[10.5px] text-muted">{desc}</div>
      <StepStatus d={data} />
      <div className="mt-2 flex justify-between font-mono text-[9.5px] text-muted">
        <span>yes</span>
        <span>no</span>
      </div>
      <Handle type="source" id="true" position={Position.Bottom} style={{ left: "22%", background: "var(--color-ok)", borderColor: "var(--color-ok)" }} />
      <Handle type="source" id="false" position={Position.Bottom} style={{ left: "78%", background: "var(--color-bad)", borderColor: "var(--color-bad)" }} />
    </div>
  );
}

function ApprovalNode({ data, selected }: NodeProps<Node<NodeData>>) {
  return (
    <div className={cx("flex w-[200px] flex-col items-center rounded-2xl bg-white p-3 shadow-[var(--shadow-card)]", selected && "ring-2 ring-ink", ring(data._status))}>
      <Handle type="target" position={Position.Top} />
      <span className="rounded-full bg-ink px-3 py-1 text-[11.5px] font-semibold text-white">You</span>
      <div className="mt-1.5 text-center text-[11.5px] text-ink-2">{data.title || "Approve to continue"}</div>
      <StepStatus d={data} />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function DelayNode({ data, selected }: NodeProps<Node<NodeData>>) {
  return (
    <div className={cx("flex items-center gap-2 rounded-full bg-white px-3.5 py-2 text-[12px] shadow-[var(--shadow-card)]", selected && "ring-2 ring-ink", ring(data._status))}>
      <Handle type="target" position={Position.Top} />
      <Timer className="size-3.5" /> Wait {data.minutes ?? 60} min
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { trigger: TriggerNode, agent: AgentNode, condition: ConditionNode, approval: ApprovalNode, delay: DelayNode };

function Inner(props: {
  workflow: WF;
  agents: AgentOpt[];
  events: string[];
  nextRuns: string[];
  timezone: string;
  runs: Run[];
  selectedRun: string | null;
  steps: Step[];
}) {
  const { workflow, agents, runs, steps, selectedRun, timezone } = props;
  const router = useRouter();
  const agentName = useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents]);
  const stepBy = useMemo(() => new Map(steps.map((s) => [s.nodeId, s])), [steps]);
  const decorate = useCallback(
    (n: WFNode): Node<NodeData> => {
      const s = stepBy.get(n.id);
      return { id: n.id, type: n.type, position: n.position, data: { ...n.data, _agentName: n.data.agentId ? agentName.get(n.data.agentId) : undefined, _status: s?.status, _branch: s?.branch, _taskId: s?.taskId }, deletable: n.type !== "trigger" };
    },
    [agentName, stepBy],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>(workflow.nodes.map(decorate));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(workflow.edges.map((e) => ({ ...e, sourceHandle: e.sourceHandle ?? undefined, animated: stepBy.get(e.source)?.status === "completed" && stepBy.get(e.target)?.status === "running" })));
  const [meta, setMeta] = useState({ name: workflow.name, description: workflow.description, triggerType: workflow.triggerType, schedule: workflow.schedule ?? "0 6 * * *", eventType: workflow.eventType ?? props.events[0] });
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(!workflow.id);

  // Fit the whole graph once node sizes are known.
  const nodesReady = useNodesInitialized();
  const rf = useReactFlow();
  const [fitted, setFitted] = useState(false);
  useEffect(() => {
    if (nodesReady && !fitted) {
      requestAnimationFrame(() => rf.fitView({ padding: 0.12, maxZoom: 1, minZoom: 0.2 }));
      setFitted(true);
    }
  }, [nodesReady, fitted, rf]);

  // Live run overlay: refresh step statuses on the canvas without touching the layout.
  useEffect(() => {
    setNodes((ns) => ns.map((n) => {
      const s = stepBy.get(n.id);
      return { ...n, data: { ...n.data, _status: s?.status, _branch: s?.branch, _taskId: s?.taskId } };
    }));
    setEdges((es) => es.map((e) => ({ ...e, animated: stepBy.get(e.source)?.status === "completed" && stepBy.get(e.target)?.status === "running" })));
  }, [stepBy, setNodes, setEdges]);

  const sel = nodes.find((n) => n.id === selected);
  const updateSel = (patch: Partial<NodeData>) => {
    setDirty(true);
    setNodes((ns) => ns.map((n) => (n.id === selected ? { ...n, data: { ...n.data, ...patch, _agentName: (patch.agentId ?? n.data.agentId) ? agentName.get(patch.agentId ?? n.data.agentId!) : undefined } } : n)));
  };

  const onConnect = useCallback(
    (c: Connection) => {
      setDirty(true);
      setEdges((es) => addEdge({ ...c, id: `e${Date.now()}` }, es));
    },
    [setEdges],
  );

  const addNode = (type: WFNode["type"]) => {
    const id = `${type}-${Math.random().toString(36).slice(2, 7)}`;
    const maxY = Math.max(0, ...nodes.map((n) => n.position.y));
    const base = sel ?? nodes[nodes.length - 1];
    const data: NodeData = type === "agent" ? { agentId: agents[0].id, instructions: "" } : type === "condition" ? { label: "If", mode: "contains", value: "" } : type === "approval" ? { title: "Approve to continue" } : { minutes: 60 };
    setNodes((ns) => [...ns, { id, type, position: { x: base?.position.x ?? 200, y: maxY + 140 }, data: { ...data, _agentName: data.agentId ? agentName.get(data.agentId) : undefined } }]);
    if (base) setEdges((es) => [...es, { id: `e${Date.now()}`, source: base.id, target: id, sourceHandle: base.type === "condition" ? "true" : undefined }]);
    setSelected(id);
    setDirty(true);
  };

  const serialize = () => ({
    name: meta.name,
    description: meta.description,
    triggerType: meta.triggerType as "manual" | "schedule" | "event",
    schedule: meta.triggerType === "schedule" ? meta.schedule : null,
    eventType: meta.triggerType === "event" ? meta.eventType : null,
    nodes: nodes.map((n) => {
      const { _agentName, _status, _branch, _taskId, ...data } = n.data;
      void _agentName;
      void _status;
      void _branch;
      void _taskId;
      return { id: n.id, type: n.type as WFNode["type"], position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data };
    }),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null })),
  });

  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string; id?: string }>, after?: (id?: string) => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: r.message ?? "Done" } : { ok: false, text: r.error ?? "Failed" });
      if (r.ok) after?.(r.id);
      router.refresh();
    });

  const save = () =>
    act(
      () => saveWorkflow(workflow.id, serialize()),
      (id) => {
        setDirty(false);
        if (!workflow.id && id) router.replace(`/workflows/${id}`);
      },
    );

  const runningRun = runs.find((r) => r.id === selectedRun);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 text-[12px] text-muted">
            <Link href="/workflows" className="hover:text-ink">
              Workflows
            </Link>
            <span>/</span>
            {workflow.id ? workflow.enabled ? <Badge tone="ok">active</Badge> : <Badge>paused</Badge> : <Badge>new</Badge>}
          </div>
          <input
            value={meta.name}
            onChange={(e) => {
              setMeta({ ...meta, name: e.target.value });
              setDirty(true);
            }}
            className="display w-full bg-transparent text-[30px] outline-none sm:text-[36px]"
            aria-label="Workflow name"
          />
          <input
            value={meta.description}
            placeholder="What does this workflow achieve?"
            onChange={(e) => {
              setMeta({ ...meta, description: e.target.value });
              setDirty(true);
            }}
            className="mt-1 w-full bg-transparent text-[13.5px] text-muted outline-none placeholder:text-faint"
            aria-label="Description"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {msg && <span className={cx("text-[12px]", msg.ok ? "text-ok" : "text-bad")}>{msg.text}</span>}
          {workflow.id && (
            <>
              <Button variant="ghost" size="sm" onClick={() => confirm("Delete this workflow?") && act(() => deleteWorkflow(workflow.id!), () => router.push("/workflows"))}>
                <Trash2 className="size-3.5" />
              </Button>
              <Button variant="outline" size="sm" disabled={pending || dirty} title={dirty ? "Save first" : undefined} onClick={() => act(() => runWorkflowNow(workflow.id!), (id) => id && router.push(`/workflows/${workflow.id}?run=${id}`))}>
                <Play className="size-3.5" /> Run now
              </Button>
              <Button variant="secondary" size="sm" disabled={pending || dirty} onClick={() => act(() => setWorkflowEnabled(workflow.id!, !workflow.enabled))}>
                {workflow.enabled ? (
                  <>
                    <Pause className="size-3.5" /> Pause
                  </>
                ) : (
                  "Enable"
                )}
              </Button>
            </>
          )}
          <Button variant="primary" size="sm" disabled={pending || !dirty} onClick={save}>
            {pending && <Asterisk className="size-3.5 text-accent" spin />} Save
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="flex h-[70vh] min-h-[500px] flex-col overflow-hidden">
          <div className="flex flex-wrap gap-1.5 border-b border-line p-2.5">
            {(
              [
                ["agent", "Agent step", Bot],
                ["condition", "Condition", GitBranch],
                ["approval", "Approval", Hand],
                ["delay", "Delay", Timer],
              ] as const
            ).map(([t, l, I]) => (
              <button key={t} onClick={() => addNode(t)} className="flex h-8 items-center gap-1.5 rounded-full bg-sunken px-3 text-[12px] font-medium transition hover:bg-line">
                <I className="size-3.5" /> {l}
              </button>
            ))}
          </div>
          <div className="relative min-h-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={(c) => {
              onNodesChange(c);
              if (c.getByType("position").length || c.getByType("remove").length) setDirty(true);
            }}
            onEdgesChange={(c) => {
              onEdgesChange(c);
              if (c.getByType("remove").length) setDirty(true);
            }}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelected(n.id)}
            onPaneClick={() => setSelected(null)}
            fitView
            fitViewOptions={{ padding: 0.12, maxZoom: 1, minZoom: 0.2 }}
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ style: { strokeWidth: 1.4 } }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#d8d8dc" />
            <Controls showInteractive={false} position="bottom-left" />
          </ReactFlow>
          </div>
        </Card>

        <div className="space-y-4">
          {sel ? (
            <Card className="space-y-3 p-4">
              <SectionTitle right={sel.type !== "trigger" && <Button size="sm" variant="ghost" onClick={() => { setNodes((ns) => ns.filter((n) => n.id !== sel.id)); setEdges((es) => es.filter((e) => e.source !== sel.id && e.target !== sel.id)); setSelected(null); setDirty(true); }}>Remove</Button>}>
                {sel.type === "trigger" ? "Trigger" : sel.type === "agent" ? "Agent step" : sel.type === "condition" ? "Condition" : sel.type === "approval" ? "Approval gate" : "Delay"}
              </SectionTitle>
              {sel.type === "agent" && (
                <>
                  <Field label="Agent">
                    <select className={inputClass} value={sel.data.agentId} onChange={(e) => updateSel({ agentId: e.target.value })}>
                      {["research", "content", "publish", "community", "sales", "loop"].map((d) => (
                        <optgroup key={d} label={d}>
                          {agents.filter((a) => a.department === d).map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} — {a.role}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </Field>
                  <Field label="Step label">
                    <input className={inputClass} value={sel.data.label ?? ""} onChange={(e) => updateSel({ label: e.target.value })} />
                  </Field>
                  <Field label="Instructions" hint="Outputs of the previous steps are passed in automatically.">
                    <textarea className={textareaClass} rows={6} value={sel.data.instructions ?? ""} onChange={(e) => updateSel({ instructions: e.target.value })} />
                  </Field>
                </>
              )}
              {sel.type === "condition" && (
                <>
                  <Field label="Label">
                    <input className={inputClass} value={sel.data.label ?? ""} onChange={(e) => updateSel({ label: e.target.value })} />
                  </Field>
                  <Field label="Check">
                    <select className={inputClass} value={sel.data.mode ?? "contains"} onChange={(e) => updateSel({ mode: e.target.value })}>
                      <option value="contains">Previous output contains text</option>
                      <option value="not_contains">Previous output does not contain</option>
                      <option value="data_gte">Structured field ≥ number</option>
                      <option value="data_lte">Structured field ≤ number</option>
                      <option value="status">Previous steps have status</option>
                    </select>
                  </Field>
                  {(sel.data.mode === "data_gte" || sel.data.mode === "data_lte") && (
                    <Field label="Field" hint="A key from the previous agent's structured data, e.g. count, qualified. Arrays use their length.">
                      <input className={inputClass} value={sel.data.field ?? ""} onChange={(e) => updateSel({ field: e.target.value })} />
                    </Field>
                  )}
                  <Field label="Value">
                    <input className={inputClass} value={sel.data.value ?? ""} onChange={(e) => updateSel({ value: e.target.value })} />
                  </Field>
                  <p className="text-[11.5px] text-muted">Connect the green handle for “yes” and the red one for “no”. Branches that don't match are skipped.</p>
                </>
              )}
              {sel.type === "approval" && (
                <Field label="Question for you" hint="The run pauses here until you approve in the inbox. Rejecting stops the run.">
                  <input className={inputClass} value={sel.data.title ?? ""} onChange={(e) => updateSel({ title: e.target.value })} />
                </Field>
              )}
              {sel.type === "delay" && (
                <Field label="Wait (minutes)">
                  <input type="number" min={1} className={inputClass} value={sel.data.minutes ?? 60} onChange={(e) => updateSel({ minutes: Number(e.target.value) })} />
                </Field>
              )}
              {sel.type === "trigger" && (
                <Field label="Label">
                  <input className={inputClass} value={sel.data.label ?? ""} onChange={(e) => updateSel({ label: e.target.value })} />
                </Field>
              )}
              {sel.data._taskId && (
                <Link href={`/tasks/${sel.data._taskId}`} className="block text-[12px] underline">
                  Open this step's task →
                </Link>
              )}
            </Card>
          ) : (
            <Card className="space-y-3 p-4">
              <SectionTitle>Trigger</SectionTitle>
              <div className="flex gap-1 rounded-full bg-sunken p-1">
                {["manual", "schedule", "event"].map((t) => (
                  <button key={t} onClick={() => { setMeta({ ...meta, triggerType: t }); setDirty(true); }} className={cx("h-7 flex-1 rounded-full text-[12px] capitalize transition", meta.triggerType === t ? "bg-white font-medium shadow-sm" : "text-muted")}>
                    {t}
                  </button>
                ))}
              </div>
              {meta.triggerType === "schedule" && (
                <>
                  <Field label="Cron expression" hint={`${describeCron(meta.schedule)} · ${timezone}`}>
                    <input className={inputClass + " font-mono"} value={meta.schedule} onChange={(e) => { setMeta({ ...meta, schedule: e.target.value }); setDirty(true); }} />
                  </Field>
                  <div className="flex flex-wrap gap-1">
                    {CRON_PRESETS.map((p) => (
                      <button key={p.value} onClick={() => { setMeta({ ...meta, schedule: p.value }); setDirty(true); }} className="h-6 rounded-full bg-sunken px-2.5 text-[11px] hover:bg-line">
                        {p.label}
                      </button>
                    ))}
                  </div>
                  {props.nextRuns.length > 0 && !dirty && (
                    <div className="text-[11.5px] text-muted">
                      Next: {props.nextRuns.map((d) => dateTime(d, timezone)).join(" · ")}
                      {!workflow.enabled && " (paused)"}
                    </div>
                  )}
                </>
              )}
              {meta.triggerType === "event" && (
                <Field label="When this happens">
                  <select className={inputClass} value={meta.eventType ?? ""} onChange={(e) => { setMeta({ ...meta, eventType: e.target.value }); setDirty(true); }}>
                    {props.events.map((e) => (
                      <option key={e}>{e}</option>
                    ))}
                  </select>
                </Field>
              )}
              {meta.triggerType === "manual" && <p className="text-[12px] text-muted">Runs only when you press Run now (or when the Loop Feeder proposes it).</p>}
              <p className="border-t border-line pt-3 text-[11.5px] text-muted">Click a step to configure it. Drag from a handle to connect steps. Select an edge and press Backspace to remove it.</p>
            </Card>
          )}

          {workflow.id && (
            <Card className="p-4">
              <SectionTitle right={runningRun && ["running", "waiting"].includes(runningRun.status) && <Button size="sm" variant="danger" onClick={() => act(() => cancelWorkflowRun(runningRun.id))}>Stop run</Button>}>Execution history</SectionTitle>
              {runs.length === 0 ? (
                <div className="text-[12.5px] text-muted">No runs yet.</div>
              ) : (
                <ul className="scroll-thin max-h-[320px] space-y-1 overflow-y-auto">
                  {runs.map((r) => (
                    <li key={r.id}>
                      <Link href={`/workflows/${workflow.id}?run=${r.id}`} scroll={false} className={cx("flex items-center justify-between gap-2 rounded-xl px-2 py-1.5 text-[12px]", r.id === selectedRun ? "bg-sunken" : "hover:bg-sunken/60")}>
                        <span>
                          <span className="font-mono text-[11px]">{dateTime(r.startedAt, timezone)}</span>
                          <span className="ml-2 text-muted">{r.trigger}</span>
                        </span>
                        <StatusBadge status={r.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {runningRun?.error && <div className="mt-2 rounded-lg bg-bad-soft p-2 text-[11.5px] text-bad">{runningRun.error}</div>}
              {runningRun && <div className="mt-2 font-mono text-[10.5px] text-muted">Showing run {runningRun.id.slice(0, 8)} on the canvas · started {timeAgo(runningRun.startedAt)}</div>}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export function Builder(props: Parameters<typeof Inner>[0]) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
