"use client";

import { useState } from "react";
import { saveSettings } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { Card, cx, Field, inputClass, SectionTitle } from "@/components/ui";
import type { ApprovalPolicy, BusinessProfile, BriefingSettings } from "@/server/lib/settings";

const POLICY_ROWS: { key: keyof Omit<ApprovalPolicy, "monthlyBudgetUsd">; label: string; hint: string; locked?: string }[] = [
  { key: "publishing", label: "Publishing content", hint: "Posting to TikTok, Instagram, YouTube, X, LinkedIn and sending newsletters." },
  { key: "external_communication", label: "External communication", hint: "Public replies and DMs. Outbound email always requires approval.", locked: "Email is always approved by you" },
  { key: "financial", label: "Financial transactions", hint: "Any spend or payment action." },
  { key: "settings_change", label: "Important business settings", hint: "Changes agents propose to configuration." },
  { key: "irreversible", label: "Irreversible actions", hint: "Deletions and anything that can't be undone." },
];

export function SettingsForms({ policy, profile, briefing, timezone }: { policy: ApprovalPolicy; profile: BusinessProfile; briefing: BriefingSettings; timezone: string }) {
  const [p, setP] = useState(policy);
  const [b, setB] = useState(profile);
  const [br, setBr] = useState(briefing);
  const toggleChannel = (c: "in_app" | "email" | "slack") => setBr({ ...br, channels: br.channels.includes(c) ? br.channels.filter((x) => x !== c) : [...br.channels, c] });

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card className="space-y-4 p-5">
        <SectionTitle>Business profile</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company name">
            <input className={inputClass} value={b.companyName} onChange={(e) => setB({ ...b, companyName: e.target.value })} />
          </Field>
          <Field label="Your name">
            <input className={inputClass} value={b.ownerName} onChange={(e) => setB({ ...b, ownerName: e.target.value })} />
          </Field>
        </div>
        <Field label="One-liner" hint="What the company does, in one sentence. Given to every agent.">
          <input className={inputClass} value={b.oneLiner} onChange={(e) => setB({ ...b, oneLiner: e.target.value })} />
        </Field>
        <Field label="Website">
          <input className={inputClass} value={b.website} onChange={(e) => setB({ ...b, website: e.target.value })} />
        </Field>
        <div className="flex justify-end">
          <ActionButton variant="primary" action={() => saveSettings({ businessProfile: b })}>
            Save profile
          </ActionButton>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <SectionTitle>Morning briefing</SectionTitle>
        <label className="flex items-center gap-3 text-[13px]">
          <input type="checkbox" className="accent-[var(--color-ink)]" checked={br.enabled} onChange={(e) => setBr({ ...br, enabled: e.target.checked })} />
          Generate a briefing automatically every day
        </label>
        <Field label="Time" hint={`Timezone: ${timezone} (APP_TIMEZONE)`}>
          <input type="time" className={inputClass + " w-40"} value={br.time} onChange={(e) => setBr({ ...br, time: e.target.value })} />
        </Field>
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-ink-2">Deliver via</div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["in_app", "In-app notification"],
                ["email", "Email (Resend)"],
                ["slack", "Slack"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} onClick={() => toggleChannel(k)} className={cx("h-8 rounded-full px-3 text-[12.5px] transition", br.channels.includes(k) ? "bg-ink text-white" : "bg-sunken text-ink-2")}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-3 text-[13px]">
          <input type="checkbox" className="accent-[var(--color-ink)]" checked={br.narrative} onChange={(e) => setBr({ ...br, narrative: e.target.checked })} />
          Let the CEO Agent write a short narrative (uses Claude; numbers always come from the database)
        </label>
        <div className="flex justify-end">
          <ActionButton variant="primary" action={() => saveSettings({ briefing: br })}>
            Save briefing
          </ActionButton>
        </div>
      </Card>

      <Card className="space-y-4 p-5 xl:col-span-2">
        <SectionTitle>Human control — what needs your approval</SectionTitle>
        <p className="-mt-1 text-[12.5px] text-muted">Low-risk internal work (research, drafting, scoring, memory) always runs autonomously. Choose which external actions agents may take on their own.</p>
        <ul className="divide-y divide-line">
          {POLICY_ROWS.map((r) => (
            <li key={r.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[13.5px] font-medium">{r.label}</div>
                <div className="text-[12px] text-muted">{r.hint}</div>
              </div>
              <div className="flex shrink-0 gap-1 rounded-full bg-sunken p-1">
                {(["require", "auto"] as const).map((m) => (
                  <button key={m} onClick={() => setP({ ...p, [r.key]: m })} className={cx("h-7 rounded-full px-3 text-[12px] transition", p[r.key] === m ? "bg-white font-medium shadow-sm" : "text-muted")}>
                    {m === "require" ? "Ask me first" : "Autonomous"}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <Field label="Monthly AI budget (USD)" hint="Agents stop taking new tasks once Claude spend this month reaches the cap. 0 = no cap.">
          <input type="number" min={0} className={inputClass + " w-40"} value={p.monthlyBudgetUsd} onChange={(e) => setP({ ...p, monthlyBudgetUsd: Number(e.target.value) })} />
        </Field>
        <div className="flex justify-end">
          <ActionButton variant="primary" confirm="Change the approval policy? This affects what agents may do without asking." action={() => saveSettings({ approvalPolicy: p })}>
            Save policy
          </ActionButton>
        </div>
      </Card>
    </div>
  );
}
