"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp } from "lucide-react";
import { assignObjective } from "@/app/actions";
import { Asterisk, cx } from "./ui";

export function ObjectiveComposer({ agents, title = "Give the company an objective", direct = false }: { agents: { id: string; name: string; department: string }[]; title?: string; direct?: boolean }) {
  const [text, setText] = useState("");
  const [agentId, setAgentId] = useState(direct ? agents[0]?.id ?? "ceo" : "ceo");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string; id?: string } | null>(null);
  const router = useRouter();

  const submit = () =>
    start(async () => {
      const r = await assignObjective({ text, agentId });
      if (r.ok) {
        setText("");
        setResult({ ok: true, text: agentId === "ceo" ? "The CEO Agent is planning it." : "Assigned.", id: r.id });
        router.refresh();
      } else setResult({ ok: false, text: r.error });
    });

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] font-semibold">{title}</div>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="h-7 rounded-full bg-sunken px-2.5 text-[12px] outline-none" aria-label="Assign to">
          {!direct && <option value="ceo">CEO Agent plans it</option>}
          {!direct && <option value="task-router">Task Router routes it</option>}
          <optgroup label="Assign directly">
            {agents
              .filter((a) => direct || (a.id !== "ceo" && a.id !== "task-router"))
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </optgroup>
        </select>
      </div>
      <div className="relative">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) submit();
          }}
          rows={3}
          placeholder="e.g. Launch our spring offer next week — research the angle, create 5 posts and line up 10 qualified leads."
          className="w-full resize-none rounded-xl bg-sunken px-3.5 py-3 pr-12 text-[13.5px] leading-relaxed outline-none transition placeholder:text-faint focus:bg-white focus:ring-1 focus:ring-line-2"
        />
        <button
          onClick={submit}
          disabled={pending || text.trim().length < 4}
          className="absolute bottom-3 right-3 grid size-8 place-items-center rounded-full bg-ink text-white transition hover:bg-ink-2 disabled:opacity-30"
          aria-label="Assign objective"
        >
          {pending ? <Asterisk className="size-4 text-accent" spin /> : <ArrowUp className="size-4" />}
        </button>
      </div>
      <div className="mt-1.5 flex min-h-5 items-center justify-between text-[11.5px]">
        {result ? (
          <span className={cx(result.ok ? "text-ok" : "text-bad")}>
            {result.text}{" "}
            {result.id && (
              <Link href={`/tasks/${result.id}`} className="underline underline-offset-2">
                Follow it →
              </Link>
            )}
          </span>
        ) : (
          <span className="text-muted">⌘/Ctrl + Enter to send</span>
        )}
      </div>
    </div>
  );
}
