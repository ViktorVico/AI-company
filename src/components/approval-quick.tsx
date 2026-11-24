"use client";

import Link from "next/link";
import { decide } from "@/app/actions";
import { ActionButton } from "./action-button";
import { Badge } from "./ui";

export function ApprovalQuick({ items }: { items: { id: string; title: string; category: string; risk: string }[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5">
          <Link href={`/approvals#${a.id}`} className="min-w-0">
            <div className="truncate text-[13px] font-medium">{a.title}</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="font-mono text-[10.5px] text-muted">{a.category.replace(/_/g, " ")}</span>
              {a.risk === "high" && <Badge tone="bad">high risk</Badge>}
            </div>
          </Link>
          <ActionButton size="sm" variant="outline" action={() => decide(a.id, true)}>
            Approve
          </ActionButton>
        </li>
      ))}
    </ul>
  );
}
