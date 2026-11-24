"use client";

import { useState } from "react";
import { saveLead, sendLeadEmail } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { AgentIcon } from "@/components/agent-icon";
import { Badge, Button, Card, cx, Empty, Field, inputClass, StatusBadge, textareaClass , Ago } from "@/components/ui";

type Lead = {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  email: string | null;
  website: string | null;
  linkedin: string | null;
  source: string | null;
  score: number | null;
  scoreReason: string | null;
  stage: string;
  notes: string | null;
  draftOutreach: string | null;
  createdByAgent: string | null;
  crmId: string | null;
  nextFollowUpAt: string | null;
  updatedAt: string;
};

export function LeadsTable({ leads, stages }: { leads: Lead[]; stages: string[] }) {
  const [stage, setStage] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = leads.filter((l) => stage === "all" || l.stage === stage);
  const sel = leads.find((l) => l.id === open);
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1 overflow-x-auto">
            {["all", ...stages].map((s) => (
              <button key={s} onClick={() => setStage(s)} className={cx("h-8 shrink-0 rounded-full px-3 text-[12.5px] capitalize", stage === s ? "bg-ink text-white" : "text-ink-2 hover:bg-surface")}>
                {s}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => { setCreating(true); setOpen(null); }}>
            Add lead
          </Button>
        </div>
        {list.length === 0 ? (
          <Empty title="No leads in this stage">Lead Finder adds prospects from public sources; DM Assistant adds buyers from conversations.</Empty>
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line">
              {list.map((l) => (
                <li key={l.id}>
                  <button onClick={() => { setOpen(l.id); setCreating(false); }} className={cx("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-sunken/60", open === l.id && "bg-sunken")}>
                    <div className={cx("grid size-9 shrink-0 place-items-center rounded-full text-[12px] font-semibold tabular", l.score == null ? "bg-sunken text-muted" : l.score >= 70 ? "bg-ok-soft text-ok" : l.score >= 50 ? "bg-accent-soft text-accent-strong" : "bg-sunken text-ink-2")}>{l.score ?? "–"}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium">
                        {l.name} {l.company && <span className="text-muted">· {l.company}</span>}
                      </div>
                      <div className="truncate font-mono text-[10.5px] text-muted">
                        {l.title ?? "—"} · {l.source ?? "manual"} · <Ago d={l.updatedAt} />
                      </div>
                    </div>
                    {l.draftOutreach && <Badge tone="accent">draft ready</Badge>}
                    {l.createdByAgent && <AgentIcon id={l.createdByAgent} className="size-3.5 text-muted" />}
                    <StatusBadge status={l.stage} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      <div>
        {(sel || creating) && <LeadPanel key={sel?.id ?? "new"} lead={sel ?? null} stages={stages} onClose={() => { setOpen(null); setCreating(false); }} />}
      </div>
    </div>
  );
}

function LeadPanel({ lead, stages, onClose }: { lead: Lead | null; stages: string[]; onClose: () => void }) {
  const [v, setV] = useState({
    name: lead?.name ?? "",
    company: lead?.company ?? "",
    title: lead?.title ?? "",
    email: lead?.email ?? "",
    website: lead?.website ?? "",
    linkedin: lead?.linkedin ?? "",
    stage: lead?.stage ?? "new",
    notes: lead?.notes ?? "",
    draftOutreach: lead?.draftOutreach ?? "",
  });
  const [subject, setSubject] = useState("");
  const f = (k: keyof typeof v, label: string) => (
    <Field label={label}>
      <input className={inputClass} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    </Field>
  );
  return (
    <Card className="sticky top-20 space-y-3 p-5">
      <div className="flex items-center justify-between">
        <div className="text-[15px] font-semibold">{lead ? lead.name : "New lead"}</div>
        <button onClick={onClose} className="text-[12px] text-muted hover:text-ink">
          close
        </button>
      </div>
      {lead?.scoreReason && (
        <div className="rounded-xl bg-sunken p-3 text-[12.5px]">
          <span className="font-medium">Score {lead.score}:</span> {lead.scoreReason}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {f("name", "Name")}
        {f("company", "Company")}
        {f("title", "Title")}
        {f("email", "Email")}
        {f("website", "Website")}
        {f("linkedin", "LinkedIn")}
      </div>
      <Field label="Stage">
        <select className={inputClass} value={v.stage} onChange={(e) => setV({ ...v, stage: e.target.value })}>
          {stages.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      <Field label="Notes">
        <textarea className={textareaClass} rows={3} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </Field>
      <Field label="Outreach draft">
        <textarea className={textareaClass} rows={6} value={v.draftOutreach} onChange={(e) => setV({ ...v, draftOutreach: e.target.value })} />
      </Field>
      <div className="flex justify-end">
        <ActionButton variant="primary" action={() => saveLead(lead?.id ?? null, v)} onDone={(r) => !lead && r.ok && onClose()}>
          Save lead
        </ActionButton>
      </div>
      {lead && (
        <div className="space-y-2 border-t border-line pt-3">
          <div className="text-[12px] font-medium text-ink-2">Send outreach email</div>
          <input className={inputClass} placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <p className="text-[11.5px] text-muted">Sends the draft above to {lead.email || "— (no email)"} through Resend. Pressing send is your explicit authorization.</p>
          <ActionButton
            variant="accent"
            disabled={!lead.email || !subject.trim() || !v.draftOutreach.trim()}
            confirm={`Send this email to ${lead.email}?`}
            action={() => sendLeadEmail(lead.id, subject, v.draftOutreach)}
          >
            Send email
          </ActionButton>
        </div>
      )}
    </Card>
  );
}
