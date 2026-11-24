"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { AgentIcon } from "./agent-icon";
import { Asterisk, cx, StatusDot } from "./ui";

export type MapAgent = { id: string; name: string; status: string; enabled: boolean; currentTask?: string | null };
export type MapDept = { id: string; name: string; agents: MapAgent[] };

const LEFT = ["research", "loop", "sales"];
const RIGHT = ["content", "publish", "community"];

function DeptCard({ d, innerRef }: { d: MapDept; innerRef: (el: HTMLDivElement | null) => void }) {
  const live = d.agents.filter((a) => a.status === "running").length;
  return (
    <div ref={innerRef} className="card p-3.5 transition-shadow hover:shadow-[var(--shadow-float)]">
      <div className="mb-2 flex items-baseline justify-between px-0.5">
        <Link href={`/departments/${d.id}`} className="text-[15px] font-semibold tracking-tight hover:underline underline-offset-4">
          {d.name}
        </Link>
        <span className="font-mono text-[10.5px] text-muted">{live ? <span className="text-accent-strong">{live} working</span> : `${d.agents.length} agents`}</span>
      </div>
      <ul className="space-y-[3px]">
        {d.agents.map((a) => (
          <li key={a.id}>
            <Link
              href={`/agents/${a.id}`}
              title={a.currentTask ? `Working on: ${a.currentTask}` : a.name}
              className={cx(
                "group flex h-[26px] items-center gap-2 rounded-[7px] px-2 text-[12.5px] transition-colors",
                a.status === "running" ? "bg-accent-soft" : a.enabled ? "bg-accent-softer hover:bg-accent-soft" : "bg-sunken text-muted",
              )}
            >
              <AgentIcon id={a.id} className={cx("size-3.5 shrink-0", a.enabled ? "text-ink-2" : "text-faint")} />
              <span className={cx("flex-1 truncate", a.status === "running" && "font-medium")}>{a.name}</span>
              {a.status === "running" && a.currentTask && <span className="hidden max-w-[45%] truncate font-mono text-[10px] text-accent-strong xl:inline">{a.currentTask}</span>}
              <StatusDot status={a.enabled ? a.status : "disabled"} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LoopMap({ depts, pending, pendingTitles, running }: { depts: MapDept[]; pending: number; pendingTitles: string[]; running: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const center = useRef<HTMLDivElement>(null);
  const cards = useRef<Record<string, HTMLDivElement | null>>({});
  const [geo, setGeo] = useState<{ w: number; h: number; ys: Record<string, number> } | null>(null);
  const [youOpen, setYouOpen] = useState(false);
  const byId = Object.fromEntries(depts.map((d) => [d.id, d]));

  useLayoutEffect(() => {
    const measure = () => {
      if (!center.current) return;
      const c = center.current.getBoundingClientRect();
      if (c.width === 0) return setGeo(null);
      const ys: Record<string, number> = {};
      for (const [id, el] of Object.entries(cards.current)) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        ys[id] = r.top - c.top + Math.min(26, r.height / 2);
      }
      setGeo({ w: c.width, h: c.height, ys });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const deptLive = (id: string) => byId[id]?.agents.some((a) => a.status === "running");
  const speed = running > 0 ? "2.4s" : "9s";

  let track = "";
  let x0 = 0,
    x1 = 0,
    r = 0;
  if (geo) {
    x0 = geo.w * 0.2;
    x1 = geo.w * 0.8;
    r = (x1 - x0) / 2;
    const y0 = 2,
      y1 = geo.h - 2;
    track = `M ${x0} ${y0 + r} A ${r} ${r} 0 0 1 ${x1} ${y0 + r} L ${x1} ${y1 - r} A ${r} ${r} 0 0 1 ${x0} ${y1 - r} Z`;
  }
  const youY = geo ? ((geo.ys.content ?? 0) + (geo.ys.publish ?? geo.h / 2)) / 2 + 20 : 0;

  const column = (ids: string[]) =>
    ids.map((id) => byId[id] && <DeptCard key={id} d={byId[id]} innerRef={(el) => (cards.current[id] = el)} />);

  return (
    <div ref={wrap} className="relative">
      {/* Mobile / tablet: central node on top, cards stacked */}
      <div className="mb-4 flex items-center gap-3 lg:hidden">
        <span className="grid size-11 place-items-center rounded-[13px] bg-ink text-accent">
          <Asterisk className="size-5" spin={running > 0} />
        </span>
        <div>
          <div className="text-[13px] font-semibold">Central intelligence</div>
          <div className="font-mono text-[11px] text-muted">{running ? `${running} agents working` : "all agents idle"}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_200px_minmax(0,1fr)] lg:gap-x-0 xl:grid-cols-[minmax(0,1fr)_240px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">{column(LEFT)}</div>

        <div ref={center} className="relative hidden lg:block" aria-hidden={!geo}>
          {geo && (
            <svg width={geo.w} height={geo.h} className="absolute inset-0 overflow-visible">
              {/* connectors */}
              {LEFT.map((id) => (
                <g key={id}>
                  <line x1={0} y1={geo.ys[id]} x2={x0} y2={geo.ys[id]} stroke={deptLive(id) ? "var(--color-accent)" : "var(--color-ink)"} strokeWidth={1.3} />
                  {deptLive(id) && <line x1={0} y1={geo.ys[id]} x2={x0} y2={geo.ys[id]} stroke="var(--color-accent-strong)" strokeWidth={2.2} strokeDasharray="8 32" style={{ animation: "flow 1.4s linear infinite" }} />}
                </g>
              ))}
              {RIGHT.map((id) => (
                <g key={id}>
                  <line x1={x1} y1={geo.ys[id]} x2={geo.w} y2={geo.ys[id]} stroke={deptLive(id) ? "var(--color-accent)" : "var(--color-ink)"} strokeWidth={1.3} />
                  {deptLive(id) && <line x1={x1} y1={geo.ys[id]} x2={geo.w} y2={geo.ys[id]} stroke="var(--color-accent-strong)" strokeWidth={2.2} strokeDasharray="8 32" style={{ animation: "flow 1.4s linear infinite reverse" }} />}
                </g>
              ))}
              {/* the loop */}
              <path d={track} fill="none" stroke="var(--color-ink)" strokeWidth={1.4} />
              <path d={track} fill="none" stroke="var(--color-accent)" strokeWidth={2.4} strokeLinecap="round" strokeDasharray="70 370" style={{ animation: `flow ${speed} linear infinite` }} />
              <path d={track} fill="none" stroke="var(--color-accent)" strokeWidth={2.4} strokeLinecap="round" strokeDasharray="40 400" strokeDashoffset={-220} style={{ animation: `flow ${speed} linear infinite` }} />
              {/* nodes */}
              {LEFT.map((id) => (
                <circle key={id} cx={x0} cy={geo.ys[id]} r={5} fill="white" stroke="var(--color-ink)" strokeWidth={1.4} />
              ))}
              {RIGHT.map((id) => (
                <circle key={id} cx={x1} cy={geo.ys[id]} r={5} fill="white" stroke="var(--color-ink)" strokeWidth={1.4} />
              ))}
            </svg>
          )}
          {geo && (
            <>
              <Link
                href="/tasks?status=running"
                className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2"
                title="Central intelligence — CEO Agent and The Loop"
              >
                <span className="grid size-[64px] place-items-center rounded-[18px] bg-ink text-accent shadow-[var(--shadow-float)] transition-transform hover:scale-105">
                  <Asterisk className="size-7" spin={running > 0} />
                </span>
                <span className="whitespace-nowrap rounded bg-canvas px-1 font-mono text-[10.5px] text-muted">{running ? `${running} working` : "central intelligence"}</span>
              </Link>
              <div className="absolute" style={{ left: x1, top: youY, transform: "translate(-50%,-50%)" }} onMouseEnter={() => setYouOpen(true)} onMouseLeave={() => setYouOpen(false)}>
                <Link href="/approvals" className="flex h-7 items-center gap-1.5 rounded-full bg-ink px-3 text-[12px] font-semibold text-white shadow-[var(--shadow-float)]">
                  You
                  {pending > 0 && <span className="rounded-full bg-accent px-1.5 text-[10.5px] tabular">{pending}</span>}
                </Link>
                {youOpen && (
                  <div className="card absolute right-1/2 top-9 z-20 w-60 translate-x-1/2 p-3 text-left shadow-[var(--shadow-float)] animate-rise">
                    <div className="mb-1.5 text-[12px] font-semibold">{pending ? `${pending} waiting for you` : "Nothing waiting for you"}</div>
                    {pendingTitles.slice(0, 4).map((t, i) => (
                      <div key={i} className="truncate text-[12px] text-ink-2">
                        · {t}
                      </div>
                    ))}
                    <div className="mt-2 font-mono text-[10.5px] text-muted">You decide brand, budget & anything external.</div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-4">{column(RIGHT)}</div>
      </div>
    </div>
  );
}
