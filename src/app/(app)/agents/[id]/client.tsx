"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAgentEnabled, updateAgent, runAgentTask, addAgentMemory, deleteMemory } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { Asterisk, Badge, Button, Card, cx, Field, inputClass, SectionTitle, textareaClass , Ago } from "@/components/ui";

export function Tabs({ tabs, active }: { tabs: { id: string; label: string }[]; active: string }) {
  return (
    <div className="scroll-thin -mx-1 mb-5 flex gap-1 overflow-x-auto px-1 pb-1">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={`?tab=${t.id}`}
          scroll={false}
          className={cx("h-8 shrink-0 rounded-full px-3.5 text-[13px] leading-8 transition", active === t.id ? "bg-ink text-white" : "text-ink-2 hover:bg-surface")}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export function AgentToggle({ id, enabled }: { id: string; enabled: boolean }) {
  return (
    <ActionButton variant={enabled ? "secondary" : "primary"} action={() => setAgentEnabled(id, !enabled)} confirm={enabled ? "Deactivate this agent? Its queued tasks will wait." : undefined}>
      {enabled ? "Deactivate" : "Activate agent"}
    </ActionButton>
  );
}

function useSave() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: r.message ?? "Saved" } : { ok: false, text: r.error ?? "Failed" });
      if (r.ok) router.refresh();
    });
  return { pending, msg, run };
}

type AgentCfg = { id: string; systemPrompt: string; inputFormat: string; outputFormat: string; model: string; effort: string; maxIterations: number; tools: string[]; permissions: string[] };

export function AgentConfig({
  agent,
  models,
  tools,
  permissions,
  section,
}: {
  agent: AgentCfg;
  models: { id: string; label: string }[];
  tools: { id: string; description: string }[];
  permissions: { id: string; label: string; sensitive?: boolean }[];
  section: "config" | "tools";
}) {
  const [v, setV] = useState(agent);
  const { pending, msg, run } = useSave();
  const dirty = JSON.stringify(v) !== JSON.stringify(agent);
  const toggle = (k: "tools" | "permissions", id: string) => setV((s) => ({ ...s, [k]: s[k].includes(id) ? s[k].filter((x) => x !== id) : [...s[k], id] }));

  const save = () =>
    run(() =>
      updateAgent(
        agent.id,
        section === "config"
          ? { systemPrompt: v.systemPrompt, inputFormat: v.inputFormat, outputFormat: v.outputFormat, model: v.model, effort: v.effort as "low", maxIterations: v.maxIterations }
          : { tools: v.tools, permissions: v.permissions },
      ),
    );

  const bar = (
    <div className="sticky bottom-4 z-10 mt-5 flex items-center justify-end gap-3">
      {msg && <span className={cx("text-[12px]", msg.ok ? "text-ok" : "text-bad")}>{msg.text}</span>}
      {dirty && (
        <Button variant="ghost" onClick={() => setV(agent)}>
          Discard
        </Button>
      )}
      <Button variant="primary" disabled={!dirty || pending} onClick={save}>
        {pending && <Asterisk className="size-3.5 text-accent" spin />} Save changes
      </Button>
    </div>
  );

  if (section === "config")
    return (
      <div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="p-5">
            <Field label="System prompt" hint="The agent's specialised mandate. Company knowledge, memory and operating rules are appended automatically at run time.">
              <textarea className={textareaClass + " min-h-[460px] font-mono text-[12.5px]"} value={v.systemPrompt} onChange={(e) => setV({ ...v, systemPrompt: e.target.value })} />
            </Field>
          </Card>
          <div className="space-y-6">
            <Card className="space-y-4 p-5">
              <Field label="Model">
                <select className={inputClass} value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })}>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Effort" hint="Higher effort = deeper reasoning, more tokens.">
                <div className="flex gap-1 rounded-full bg-sunken p-1">
                  {["low", "medium", "high", "xhigh"].map((e) => (
                    <button key={e} onClick={() => setV({ ...v, effort: e })} className={cx("h-7 flex-1 rounded-full text-[12px] transition", v.effort === e ? "bg-white font-medium shadow-sm" : "text-muted")}>
                      {e}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Max steps per task" hint="Upper bound on model turns before the task fails.">
                <input type="number" min={2} max={40} className={inputClass} value={v.maxIterations} onChange={(e) => setV({ ...v, maxIterations: Number(e.target.value) })} />
              </Field>
            </Card>
            <Card className="space-y-4 p-5">
              <Field label="Input format">
                <textarea className={textareaClass} rows={3} value={v.inputFormat} onChange={(e) => setV({ ...v, inputFormat: e.target.value })} />
              </Field>
              <Field label="Output format">
                <textarea className={textareaClass} rows={4} value={v.outputFormat} onChange={(e) => setV({ ...v, outputFormat: e.target.value })} />
              </Field>
            </Card>
          </div>
        </div>
        {bar}
      </div>
    );

  return (
    <div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle right={<span className="font-mono text-[11px] text-muted">{v.tools.length} enabled</span>}>Tools</SectionTitle>
          <ul className="space-y-1">
            {tools.map((t) => (
              <li key={t.id}>
                <label className="flex cursor-pointer gap-3 rounded-xl px-2 py-2 hover:bg-sunken">
                  <input type="checkbox" className="mt-0.5 accent-[var(--color-ink)]" checked={v.tools.includes(t.id)} onChange={() => toggle("tools", t.id)} />
                  <span>
                    <span className="font-mono text-[12px] font-medium">{t.id}</span>
                    <span className="block text-[12px] text-muted">{t.description}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <SectionTitle right={<span className="font-mono text-[11px] text-muted">{v.permissions.length} granted</span>}>Permissions</SectionTitle>
          <p className="mb-3 text-[12px] text-muted">Tools check these at run time. Sensitive actions additionally follow your approval policy in Settings — external email always needs your approval.</p>
          <ul className="space-y-1">
            {permissions.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-sunken">
                  <input type="checkbox" className="accent-[var(--color-ink)]" checked={v.permissions.includes(p.id)} onChange={() => toggle("permissions", p.id)} />
                  <span className="flex-1 text-[13px]">{p.label}</span>
                  <span className="font-mono text-[10.5px] text-muted">{p.id}</span>
                  {p.sensitive && <Badge tone="warn">sensitive</Badge>}
                </label>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      {bar}
    </div>
  );
}

export function RunTaskForm({ agentId, agentName, inputFormat, disabled }: { agentId: string; agentName: string; inputFormat: string; disabled: boolean }) {
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ ok: boolean; text: string; id?: string } | null>(null);
  const router = useRouter();
  return (
    <Card className="p-5">
      <SectionTitle>Trigger a task manually</SectionTitle>
      <div className="space-y-3">
        <input className={inputClass} placeholder={`What should ${agentName} do?`} value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className={textareaClass} rows={3} placeholder={`Details (optional). Expects: ${inputFormat}`} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        <div className="flex items-center justify-between gap-3">
          <span className={cx("text-[12px]", res ? (res.ok ? "text-ok" : "text-bad") : "text-muted")}>
            {res ? (
              <>
                {res.text}{" "}
                {res.id && (
                  <Link className="underline" href={`/tasks/${res.id}`}>
                    Open →
                  </Link>
                )}
              </>
            ) : disabled ? (
              "Agent is deactivated — the task will wait in the queue."
            ) : null}
          </span>
          <Button
            variant="primary"
            disabled={pending || !title.trim()}
            onClick={() =>
              start(async () => {
                const r = await runAgentTask(agentId, title, instructions);
                setRes(r.ok ? { ok: true, text: "Queued.", id: r.id } : { ok: false, text: r.error });
                if (r.ok) {
                  setTitle("");
                  setInstructions("");
                  router.refresh();
                }
              })
            }
          >
            {pending && <Asterisk className="size-3.5 text-accent" spin />} Run task
          </Button>
        </div>
      </div>
    </Card>
  );
}

type Mem = { id: number; kind: string; title: string; content: string; importance: number; source: string | null; createdAt: string };
export function MemoryPanel({ agentId, memories }: { agentId: string | null; memories: Mem[] }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const { pending, msg, run } = useSave();
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="p-5">
        <SectionTitle>{agentId ? "Private memory" : "Company memory"}</SectionTitle>
        {memories.length === 0 ? (
          <div className="text-[13px] text-muted">No memories yet. Agents write here with the remember tool as they learn.</div>
        ) : (
          <ul className="divide-y divide-line">
            {memories.map((m) => (
              <li key={m.id} className="flex gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">{m.title}</span>
                    <Badge>{m.kind}</Badge>
                    <span className="font-mono text-[10.5px] text-muted">
                      {"★".repeat(m.importance)} · {m.source?.startsWith("task:") ? <Link className="underline" href={`/tasks/${m.source.slice(5)}`}>from task</Link> : m.source} · <Ago d={m.createdAt} />
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-ink-2">{m.content}</p>
                </div>
                <ActionButton size="sm" variant="ghost" confirm="Delete this memory?" action={() => deleteMemory(m.id)}>
                  Delete
                </ActionButton>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="h-fit space-y-3 p-5">
        <SectionTitle>Add a memory</SectionTitle>
        <input className={inputClass} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className={textareaClass} rows={5} placeholder="What should be remembered?" value={content} onChange={(e) => setContent(e.target.value)} />
        <div className="flex items-center justify-between">
          <span className={cx("text-[12px]", msg?.ok ? "text-ok" : "text-bad")}>{msg?.text}</span>
          <Button
            variant="primary"
            disabled={pending || !title || !content}
            onClick={() =>
              run(async () => {
                const r = await addAgentMemory(agentId, title, content);
                if (r.ok) {
                  setTitle("");
                  setContent("");
                }
                return r;
              })
            }
          >
            Save memory
          </Button>
        </div>
      </Card>
    </div>
  );
}
