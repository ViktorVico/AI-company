"use client";

import { useState } from "react";
import { addConversation, replyToConversation, setConversationStatus } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { Button, Card, inputClass, textareaClass } from "@/components/ui";

export function ReplyBox({ id, draft, canSend, status }: { id: string; draft: string; canSend: boolean; status: string }) {
  const [text, setText] = useState(draft);
  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      <textarea className={textareaClass} rows={2} placeholder="Reply…" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {status !== "closed" && (
          <ActionButton size="sm" variant="ghost" action={() => setConversationStatus(id, "closed")}>
            Close
          </ActionButton>
        )}
        <ActionButton
          size="sm"
          variant="primary"
          disabled={!canSend || !text.trim()}
          title={canSend ? undefined : "Added manually or already replied — reply on the platform directly"}
          confirm="Post this reply publicly via the platform API?"
          action={() => replyToConversation(id, text)}
        >
          Send reply
        </ActionButton>
      </div>
    </div>
  );
}

export function AddConversation() {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ platform: "instagram", kind: "dm", author: "", text: "" });
  if (!open)
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Add conversation
      </Button>
    );
  return (
    <Card className="w-full space-y-2 p-4 sm:w-[420px]">
      <div className="flex gap-2">
        <select className={inputClass} value={v.platform} onChange={(e) => setV({ ...v, platform: e.target.value })}>
          {["instagram", "tiktok", "youtube", "x", "linkedin", "email", "other"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select className={inputClass} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
          {["dm", "comment", "mention"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </div>
      <input className={inputClass} placeholder="Author (@handle or name)" value={v.author} onChange={(e) => setV({ ...v, author: e.target.value })} />
      <textarea className={textareaClass} rows={3} placeholder="Message" value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <ActionButton size="sm" variant="primary" action={() => addConversation(v)} onDone={(r) => r.ok && (setOpen(false), setV({ ...v, author: "", text: "" }))}>
          Add
        </ActionButton>
      </div>
    </Card>
  );
}
