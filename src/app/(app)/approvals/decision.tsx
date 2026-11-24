"use client";

import { useState } from "react";
import { decide } from "@/app/actions";
import { ActionButton } from "@/components/action-button";
import { inputClass } from "@/components/ui";

export function DecisionBar({ id }: { id: string }) {
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <input className={inputClass + " sm:flex-1"} placeholder="Optional note (agents learn from it)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2">
        <ActionButton variant="danger" action={() => decide(id, false, note || undefined)}>
          Reject
        </ActionButton>
        <ActionButton variant="primary" action={() => decide(id, true, note || undefined)}>
          Approve
        </ActionButton>
      </div>
    </div>
  );
}
