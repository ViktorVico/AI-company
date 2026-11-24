import Link from "next/link";
import { db, schema } from "@/db";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { DEPARTMENTS } from "@/server/agents/catalog";
import { NavLinks, MobileNav, Notifications } from "./shell-client";
import { Asterisk } from "./ui";
import type { ReactNode } from "react";

export async function Shell({ children }: { children: ReactNode }) {
  const [pending] = await db.select({ c: sql<number>`count(*)` }).from(schema.approvals).where(eq(schema.approvals.status, "pending"));
  const agents = await db.select({ id: schema.agents.id, department: schema.agents.department, status: schema.agents.status, enabled: schema.agents.enabled }).from(schema.agents).orderBy(asc(schema.agents.sortOrder));
  const notes = await db.select().from(schema.notifications).orderBy(sql`${schema.notifications.id} desc`).limit(20);
  const [unread] = await db.select({ c: sql<number>`count(*)` }).from(schema.notifications).where(isNull(schema.notifications.readAt));

  const depts = DEPARTMENTS.map((d) => {
    const a = agents.filter((x) => x.department === d.id);
    return { id: d.id, name: d.name, running: a.filter((x) => x.status === "running").length, attention: a.filter((x) => x.status === "attention").length };
  });
  const approvals = Number(pending.c);

  const nav = (
    <NavLinks
      approvals={approvals}
      depts={depts}
    />
  );

  return (
    <div className="min-h-dvh lg:pl-[248px]">
      <aside className="fixed inset-y-0 left-0 hidden w-[248px] flex-col border-r border-line/70 bg-canvas px-4 py-5 lg:flex">
        <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
          <span className="grid size-8 place-items-center rounded-[10px] bg-ink text-accent">
            <Asterisk className="size-4" />
          </span>
          <span className="leading-tight">
            <span className="block text-[14px] font-semibold tracking-tight">AI Company</span>
            <span className="block font-mono text-[10.5px] text-muted">36 agents · 1 loop</span>
          </span>
        </Link>
        <div className="scroll-thin -mx-1 flex-1 overflow-y-auto px-1">{nav}</div>
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line/70 bg-canvas/85 px-4 backdrop-blur-md lg:px-8">
        <div className="flex items-center gap-2 lg:hidden">
          <MobileNav>{nav}</MobileNav>
          <Link href="/" className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-[9px] bg-ink text-accent">
              <Asterisk className="size-3.5" />
            </span>
            <span className="text-[14px] font-semibold tracking-tight">AI Company</span>
          </Link>
        </div>
        <div className="hidden lg:block" />
        <div className="flex items-center gap-2">
          <Link
            href="/approvals"
            className="group flex h-8 items-center gap-2 rounded-full bg-ink pl-3 pr-2 text-[12px] font-medium text-white transition hover:bg-ink-2"
          >
            You
            <span className={approvals ? "rounded-full bg-accent px-1.5 text-[11px] tabular" : "rounded-full bg-white/15 px-1.5 text-[11px] tabular"}>{approvals}</span>
          </Link>
          <Notifications
            unread={Number(unread.c)}
            items={notes.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, at: n.createdAt.toISOString(), read: !!n.readAt }))}
          />
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1400px] px-4 pb-20 pt-6 sm:px-6 lg:px-8 lg:pt-8">{children}</main>
    </div>
  );
}
