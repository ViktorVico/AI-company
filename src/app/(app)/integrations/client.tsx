"use client";

import { useState } from "react";
import { saveIntegration, testIntegration, setIntegrationEnabled } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { Badge, Button, Card, cx, Field, inputClass , Ago } from "@/components/ui";

type Props = {
  def: { id: string; name: string; description: string; permissions: string[]; usedBy: string[]; docs: string; fields: { key: string; label: string; env: string; secret: boolean; optional: boolean; placeholder?: string }[] };
  set: Record<string, boolean>;
  publicValues: Record<string, string>;
  source: string;
  enabled: boolean;
  connected: boolean;
  missing: string[];
  lastSyncAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
};

export function IntegrationCard(p: Props) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const errorIsLatest = p.lastError && (!p.lastSyncAt || (p.lastErrorAt && p.lastErrorAt > p.lastSyncAt));
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={cx("size-2 rounded-full", p.connected ? (errorIsLatest ? "bg-warn" : "bg-ok") : "bg-faint")} />
            <h3 className="text-[15px] font-semibold tracking-tight">{p.def.name}</h3>
          </div>
          <p className="mt-1 text-[12.5px] text-muted">{p.def.description}</p>
        </div>
        {p.connected ? <Badge tone={errorIsLatest ? "warn" : "ok"}>{errorIsLatest ? "error" : "connected"}</Badge> : <Badge>{p.enabled ? "disconnected" : "disabled"}</Badge>}
      </div>

      <dl className="mt-4 space-y-1.5 text-[12px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Permissions</dt>
          <dd className="text-right font-mono text-[11px]">{p.def.permissions.join(", ")}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Credentials</dt>
          <dd>{p.source === "db" ? "saved (encrypted)" : p.source === "env" ? "environment variables" : "not set"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Last successful sync</dt>
          <dd>{p.lastSyncAt ? <Ago d={p.lastSyncAt} /> : "never"}</dd>
        </div>
        {!p.connected && p.missing.length > 0 && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Missing</dt>
            <dd className="text-right">{p.missing.join(", ")}</dd>
          </div>
        )}
      </dl>
      {p.lastError && (
        <div className={cx("mt-3 rounded-lg p-2.5 text-[11.5px]", errorIsLatest ? "bg-bad-soft text-bad" : "bg-sunken text-muted")}>
          <span className="font-medium">{errorIsLatest ? "Last error" : "Earlier error"} {p.lastErrorAt && <>· <Ago d={p.lastErrorAt} /></>}:</span> {p.lastError}
        </div>
      )}

      {open && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          {p.def.fields.map((f) => (
            <Field key={f.key} label={`${f.label}${f.optional ? " (optional)" : ""}`} hint={<span className="font-mono">env: {f.env}</span>}>
              <input
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                className={inputClass}
                placeholder={f.secret && p.set[f.key] ? "•••••••• saved — leave empty to keep" : (p.publicValues[f.key] ?? f.placeholder ?? "")}
                value={vals[f.key] ?? ""}
                onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
              />
            </Field>
          ))}
          <p className="text-[11.5px] text-muted">
            Get credentials:{" "}
            <a className="underline" href={p.def.docs} target="_blank" rel="noreferrer">
              {new URL(p.def.docs).host}
            </a>
            . Type <span className="font-mono">-</span> in a field to clear a saved value.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <ActionButton variant="primary" action={() => saveIntegration(p.def.id, vals)} onDone={(r) => r.ok && (setVals({}), setOpen(false))}>
              Save credentials
            </ActionButton>
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        {!open && (
          <Button size="sm" variant={p.connected ? "secondary" : "primary"} onClick={() => setOpen(true)}>
            {p.connected ? "Configure" : "Connect"}
          </Button>
        )}
        {p.connected && (
          <ActionButton size="sm" variant="outline" action={() => testIntegration(p.def.id)}>
            Test connection
          </ActionButton>
        )}
        {(p.source !== "none" || !p.enabled) && (
          <ActionButton size="sm" variant="ghost" action={() => setIntegrationEnabled(p.def.id, !p.enabled)}>
            {p.enabled ? "Disable" : "Enable"}
          </ActionButton>
        )}
      </div>
    </Card>
  );
}
