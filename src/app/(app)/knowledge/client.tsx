"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveDoc, deleteDoc, uploadDoc } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { Asterisk, Badge, Button, Card, cx, Field, inputClass, textareaClass , Ago } from "@/components/ui";

export const CATEGORIES = [
  { id: "objectives", label: "Business objectives", core: true, hint: "Goals, targets and priorities for this quarter." },
  { id: "brand", label: "Brand identity", core: true, hint: "Mission, positioning, visual identity, colours, do's and don'ts." },
  { id: "audience", label: "Target audiences", core: true, hint: "ICP, personas, their pains, desires and language." },
  { id: "products", label: "Products & services", core: true, hint: "What you sell, features, proof points." },
  { id: "tone", label: "Tone of voice", core: true, hint: "How the brand sounds; banned words; example copy." },
  { id: "pricing", label: "Pricing", hint: "Plans, prices, discounts, terms." },
  { id: "competitors", label: "Competitors", hint: "Who they are, their URLs and positioning." },
  { id: "strategy", label: "Marketing strategy", hint: "Channels, cadence, campaigns, newsletter sources." },
  { id: "campaigns", label: "Previous campaigns", hint: "What ran, what happened." },
  { id: "performance", label: "Historical performance", hint: "Benchmarks and results." },
  { id: "other", label: "Other", hint: "Anything else agents should know." },
];

type Doc = { id: number; category: string; title: string; content: string; fileName: string | null; updatedAt: string };

export function KnowledgeBase({ docs }: { docs: Doc[] }) {
  const [editing, setEditing] = useState<Doc | { id: null; category: string; title: string; content: string } | null>(null);
  const [cat, setCat] = useState("all");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadCat, setUploadCat] = useState("other");
  const router = useRouter();
  const missingCore = CATEGORIES.filter((c) => c.core && !docs.some((d) => d.category === c.id));

  return (
    <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
      <div className="space-y-1">
        {[{ id: "all", label: "All documents" }, ...CATEGORIES].map((c) => {
          const n = c.id === "all" ? docs.length : docs.filter((d) => d.category === c.id).length;
          return (
            <button key={c.id} onClick={() => setCat(c.id)} className={cx("flex h-8 w-full items-center justify-between rounded-lg px-2.5 text-left text-[13px]", cat === c.id ? "bg-surface font-medium shadow-sm" : "text-ink-2 hover:bg-surface/60")}>
              <span className="flex items-center gap-1.5">
                {c.label}
                {"core" in c && c.core && <span className="size-1 rounded-full bg-accent" title="Always in agent context" />}
              </span>
              <span className="font-mono text-[11px] text-muted">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        {missingCore.length > 0 && (
          <Card className="border border-accent/20 bg-accent-softer p-4">
            <div className="text-[13px] font-semibold">Teach the company the basics</div>
            <p className="mt-1 text-[12.5px] text-ink-2">Agents are told not to invent business facts. Fill these in so their work is specific to you:</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {missingCore.map((c) => (
                <Button key={c.id} size="sm" variant="outline" onClick={() => setEditing({ id: null, category: c.id, title: c.label, content: "" })}>
                  + {c.label}
                </Button>
              ))}
            </div>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => setEditing({ id: null, category: cat === "all" ? "other" : cat, title: "", content: "" })}>
            New document
          </Button>
          <select className="h-7 rounded-full bg-sunken px-2.5 text-[12px]" value={uploadCat} onChange={(e) => setUploadCat(e.target.value)} aria-label="Upload category">
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            ref={fileRef}
            type="file"
            accept=".md,.txt,.csv,.json,.pdf,.html"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.append("file", f);
              fd.append("category", uploadCat);
              start(async () => {
                const r = await uploadDoc(fd);
                setMsg(r.ok ? { ok: true, text: `Uploaded ${f.name}` } : { ok: false, text: r.error });
                if (r.ok) router.refresh();
                if (fileRef.current) fileRef.current.value = "";
              });
            }}
          />
          <Button size="sm" disabled={pending} onClick={() => fileRef.current?.click()}>
            {pending && <Asterisk className="size-3.5 text-accent" spin />} Upload file
          </Button>
          <span className="text-[11.5px] text-muted">.md .txt .csv .json .html — PDFs are transcribed by Claude</span>
          {msg && <span className={cx("text-[12px]", msg.ok ? "text-ok" : "text-bad")}>{msg.text}</span>}
        </div>

        {editing && (
          <Card className="space-y-3 p-5 animate-rise">
            <div className="grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]">
              <Field label="Category">
                <select className={inputClass} value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Title">
                <input className={inputClass} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </Field>
            </div>
            <Field label="Content" hint={CATEGORIES.find((c) => c.id === editing.category)?.hint}>
              <textarea className={textareaClass + " min-h-[260px]"} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <ActionButton variant="primary" action={() => saveDoc(editing.id, { category: editing.category, title: editing.title, content: editing.content })} onDone={(r) => r.ok && setEditing(null)}>
                Save document
              </ActionButton>
            </div>
          </Card>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          {docs
            .filter((d) => cat === "all" || d.category === cat)
            .map((d) => (
              <Card key={d.id} className="flex flex-col p-4">
                <div className="flex items-center gap-2">
                  <Badge>{CATEGORIES.find((c) => c.id === d.category)?.label ?? d.category}</Badge>
                  {d.fileName && <span className="truncate font-mono text-[10.5px] text-muted">{d.fileName}</span>}
                  <span className="ml-auto font-mono text-[10.5px] text-muted"><Ago d={d.updatedAt} /></span>
                </div>
                <div className="mt-2 text-[14px] font-semibold">{d.title}</div>
                <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[12.5px] text-ink-2">{d.content}</p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => setEditing(d)}>
                    Edit
                  </Button>
                  <ActionButton size="sm" variant="ghost" confirm="Delete this document?" action={() => deleteDoc(d.id)}>
                    Delete
                  </ActionButton>
                </div>
              </Card>
            ))}
        </div>
      </div>
    </div>
  );
}
