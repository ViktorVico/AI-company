"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateContentItem, setContentStatus, scheduleContentItem, publishContentNow, deleteContent } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { Asterisk, Button, Card, cx, Field, inputClass, SectionTitle, textareaClass } from "@/components/ui";

type Item = { id: string; title: string; hook: string; caption: string; script: string; body: string; productionNotes: string; hashtags: string[]; assets: { kind: string; url: string; label?: string; prompt?: string }[] };

export function ContentEditor({ item, locked }: { item: Item; locked: boolean }) {
  const [v, setV] = useState({ ...item, tags: item.hashtags.join(" ") });
  const [newAsset, setNewAsset] = useState({ kind: "video", url: "" });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const save = (extra?: Partial<Item>) =>
    start(async () => {
      const r = await updateContentItem(item.id, {
        title: v.title,
        hook: v.hook,
        caption: v.caption,
        script: v.script,
        body: v.body,
        productionNotes: v.productionNotes,
        hashtags: v.tags.split(/[\s,]+/).filter(Boolean),
        ...extra,
      });
      setMsg(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });

  const area = (k: keyof typeof v, label: string, rows = 4, hint?: string) => (
    <Field label={label} hint={hint}>
      <textarea disabled={locked} className={textareaClass} rows={rows} value={v[k] as string} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
    </Field>
  );

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-5">
        <Field label="Title">
          <input disabled={locked} className={inputClass} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
        </Field>
        <Field label="Hook">
          <input disabled={locked} className={inputClass} value={v.hook} onChange={(e) => setV({ ...v, hook: e.target.value })} />
        </Field>
        {area("caption", "Caption", 4)}
        {area("body", "Body / post text / slides", 8, "X threads: separate posts with a line containing only ---")}
        {area("script", "Script", 6)}
        <Field label="Hashtags">
          <input disabled={locked} className={inputClass} value={v.tags} onChange={(e) => setV({ ...v, tags: e.target.value })} />
        </Field>
        {area("productionNotes", "Production notes", 6)}
        {!locked && (
          <div className="flex items-center justify-end gap-3">
            {msg && <span className={cx("text-[12px]", msg.ok ? "text-ok" : "text-bad")}>{msg.text}</span>}
            <Button variant="primary" disabled={pending} onClick={() => save()}>
              {pending && <Asterisk className="size-3.5 text-accent" spin />} Save
            </Button>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle>Assets</SectionTitle>
        {item.assets.length === 0 && <div className="mb-3 text-[13px] text-muted">No assets yet. Visual Designer and Voiceover Producer attach generated media here.</div>}
        <div className="grid gap-3 sm:grid-cols-2">
          {item.assets.map((a, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-line">
              {a.kind === "image" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.url} alt={a.prompt ?? ""} className="aspect-square w-full object-cover" />
              )}
              {a.kind === "audio" && <audio controls src={a.url} className="w-full p-2" />}
              {a.kind === "video" && <video controls src={a.url} className="w-full" />}
              <div className="flex items-center justify-between gap-2 p-2.5 text-[11.5px]">
                <span className="truncate text-muted">{a.label ?? a.kind}</span>
                {!locked && (
                  <button className="text-bad hover:underline" onClick={() => save({ assets: item.assets.filter((_, j) => j !== i) })}>
                    remove
                  </button>
                )}
              </div>
              {a.prompt && <div className="line-clamp-3 px-2.5 pb-2.5 text-[11px] text-muted">{a.prompt}</div>}
            </div>
          ))}
        </div>
        {!locked && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <select className={inputClass + " sm:w-28"} value={newAsset.kind} onChange={(e) => setNewAsset({ ...newAsset, kind: e.target.value })}>
              <option value="video">video</option>
              <option value="image">image</option>
              <option value="audio">audio</option>
            </select>
            <input className={inputClass} placeholder="Public media URL (e.g. your edited video)" value={newAsset.url} onChange={(e) => setNewAsset({ ...newAsset, url: e.target.value })} />
            <Button disabled={!/^https?:\/\//.test(newAsset.url) || pending} onClick={() => { save({ assets: [...item.assets, { kind: newAsset.kind, url: newAsset.url, label: "Added by owner" }] }); setNewAsset({ ...newAsset, url: "" }); }}>
              Attach
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

export function ContentActions({ id, status, connected, platform, scheduledFor }: { id: string; status: string; connected: boolean; platform: string; scheduledFor: string | null }) {
  const toLocal = (iso: string | null) => {
    const d = iso ? new Date(iso) : new Date(Date.now() + 3600_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const [at, setAt] = useState(toLocal(scheduledFor));
  const router = useRouter();
  return (
    <Card className="space-y-3 p-5">
      <SectionTitle>Actions</SectionTitle>
      {!connected && <div className="rounded-lg bg-warn-soft p-2.5 text-[12px] text-warn">{platform} is not connected — publishing will fail until you connect it on the Integrations page.</div>}
      <div className="flex flex-wrap gap-2">
        {status === "draft" && (
          <ActionButton size="sm" action={() => setContentStatus(id, "in_review")}>
            Send to review
          </ActionButton>
        )}
        {["draft", "in_review", "rejected"].includes(status) && (
          <ActionButton size="sm" variant="primary" action={() => setContentStatus(id, "approved")}>
            Approve
          </ActionButton>
        )}
        {["draft", "in_review", "approved", "scheduled"].includes(status) && (
          <ActionButton size="sm" variant="danger" action={() => setContentStatus(id, "rejected")}>
            Reject
          </ActionButton>
        )}
        {["approved", "scheduled", "failed"].includes(status) && (
          <ActionButton size="sm" variant="accent" disabled={!connected} confirm={`Publish to ${platform} now via its official API?`} action={() => publishContentNow(id)}>
            Publish now
          </ActionButton>
        )}
      </div>
      {["approved", "scheduled", "failed"].includes(status) && (
        <div className="space-y-2 border-t border-line pt-3">
          <Field label="Schedule for" hint="The publishing agent picks it up when it's due.">
            <input type="datetime-local" className={inputClass} value={at} onChange={(e) => setAt(e.target.value)} />
          </Field>
          <ActionButton size="sm" variant="outline" action={() => scheduleContentItem(id, new Date(at).toISOString())}>
            {status === "scheduled" ? "Reschedule" : "Schedule"}
          </ActionButton>
        </div>
      )}
      {status !== "published" && (
        <div className="border-t border-line pt-3">
          <ActionButton size="sm" variant="ghost" confirm="Delete this content item?" action={() => deleteContent(id)} onDone={(r) => r.ok && router.push("/content")}>
            Delete
          </ActionButton>
        </div>
      )}
    </Card>
  );
}
