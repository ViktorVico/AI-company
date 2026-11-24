"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  LayoutGrid, Sun, Stamp, Workflow, ListTodo, Clapperboard, MessagesSquare, BadgeDollarSign, BookOpen, Plug, Settings, Bell, Menu, X, LogOut,
} from "lucide-react";
import { cx, StatusDot } from "./ui";
import { useLive } from "./live";
import { logout, markNotificationsRead } from "@/app/actions";
import { timeAgo } from "@/lib/format";

const MAIN = [
  { href: "/", label: "Command center", icon: LayoutGrid },
  { href: "/briefing", label: "Morning page", icon: Sun },
  { href: "/approvals", label: "Approvals", icon: Stamp, badge: true },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
];
const WORK = [
  { href: "/content", label: "Content", icon: Clapperboard },
  { href: "/community", label: "Community", icon: MessagesSquare },
  { href: "/leads", label: "Leads", icon: BadgeDollarSign },
  { href: "/knowledge", label: "Knowledge", icon: BookOpen },
];
const SYS = [
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
];

function Item({ href, label, icon: Icon, count, active }: { href: string; label: string; icon: typeof LayoutGrid; count?: number; active: boolean }) {
  return (
    <Link
      href={href}
      className={cx(
        "group flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors",
        active ? "bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)]" : "text-ink-2 hover:bg-surface/60",
      )}
    >
      <Icon className={cx("size-[15px]", active ? "text-ink" : "text-muted group-hover:text-ink-2")} strokeWidth={1.8} />
      <span className="flex-1 truncate">{label}</span>
      {!!count && <span className="rounded-full bg-accent px-1.5 text-[10.5px] font-medium text-white tabular">{count}</span>}
    </Link>
  );
}

export function NavLinks({ approvals, depts }: { approvals: number; depts: { id: string; name: string; running: number; attention: number }[] }) {
  const path = usePathname();
  const { connected } = useLive();
  const is = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));
  return (
    <nav className="flex flex-col gap-0.5 text-[13px]">
      {MAIN.map((i) => (
        <Item key={i.href} {...i} active={is(i.href)} count={i.badge ? approvals : undefined} />
      ))}
      <div className="mb-1 mt-5 px-2 font-mono text-[10.5px] uppercase tracking-wider text-faint">Departments</div>
      {depts.map((d) => (
        <Link
          key={d.id}
          href={`/departments/${d.id}`}
          className={cx("flex h-8 items-center gap-2.5 rounded-lg px-2 transition-colors", is(`/departments/${d.id}`) ? "bg-surface font-medium shadow-[0_1px_2px_rgba(0,0,0,0.05)]" : "text-ink-2 hover:bg-surface/60")}
        >
          <StatusDot status={d.attention ? "attention" : d.running ? "running" : "idle"} className="mx-[4.5px]" />
          <span className="flex-1">{d.name}</span>
          {d.running > 0 && <span className="font-mono text-[10.5px] text-accent-strong">{d.running} live</span>}
        </Link>
      ))}
      <div className="mb-1 mt-5 px-2 font-mono text-[10.5px] uppercase tracking-wider text-faint">Operations</div>
      {WORK.map((i) => (
        <Item key={i.href} {...i} active={is(i.href)} />
      ))}
      <div className="mb-1 mt-5 px-2 font-mono text-[10.5px] uppercase tracking-wider text-faint">System</div>
      {SYS.map((i) => (
        <Item key={i.href} {...i} active={is(i.href)} />
      ))}
      <div className="mt-6 flex items-center justify-between px-2">
        <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted">
          <span className={cx("size-1.5 rounded-full", connected ? "bg-ok animate-pulse-dot" : "bg-faint")} />
          {connected ? "live" : "connecting"}
        </span>
        <form action={logout}>
          <button className="flex items-center gap-1 text-[11.5px] text-muted hover:text-ink" title="Sign out">
            <LogOut className="size-3.5" /> Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}

export function MobileNav({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <>
      <button onClick={() => setOpen(true)} className="grid size-8 place-items-center rounded-lg hover:bg-surface" aria-label="Open menu">
        <Menu className="size-4" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/20 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[280px] overflow-y-auto bg-canvas p-4 shadow-[var(--shadow-float)] animate-rise">
            <button onClick={() => setOpen(false)} className="mb-3 ml-auto grid size-8 place-items-center rounded-lg hover:bg-surface" aria-label="Close menu">
              <X className="size-4" />
            </button>
            {children}
          </div>
        </div>
      )}
    </>
  );
}

type Note = { id: number; title: string; body: string | null; href: string | null; at: string; read: boolean };
export function Notifications({ unread, items }: { unread: number; items: Note[] }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(unread);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => setCount(unread), [unread]);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (count) {
            setCount(0);
            markNotificationsRead();
          }
        }}
        className="relative grid size-8 place-items-center rounded-full hover:bg-surface"
        aria-label="Notifications"
      >
        <Bell className="size-4" strokeWidth={1.8} />
        {count > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent ring-2 ring-canvas" />}
      </button>
      {open && (
        <div className="card absolute right-0 top-10 z-40 w-[min(360px,calc(100vw-32px))] overflow-hidden p-1 shadow-[var(--shadow-float)] animate-rise">
          <div className="px-3 py-2 text-[12px] font-medium text-muted">Notifications</div>
          <div className="scroll-thin max-h-[60vh] overflow-y-auto">
            {items.length === 0 && <div className="px-3 pb-4 text-[13px] text-muted">Nothing yet.</div>}
            {items.map((n) => (
              <Link key={n.id} href={n.href ?? "#"} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2.5 hover:bg-sunken">
                <div className="flex items-start justify-between gap-3">
                  <div className={cx("text-[13px]", !n.read && "font-medium")}>{n.title}</div>
                  <span className="shrink-0 font-mono text-[10.5px] text-muted" suppressHydrationWarning>{timeAgo(n.at)}</span>
                </div>
                {n.body && <div className="mt-0.5 line-clamp-2 text-[12px] text-muted">{n.body}</div>}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
