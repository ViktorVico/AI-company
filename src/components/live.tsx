"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export type LiveEvent = { id: number; type: string; agentId: string | null; taskId: string | null; message: string; createdAt: string };

const Ctx = createContext<{ events: LiveEvent[]; connected: boolean }>({ events: [], connected: false });

/** One SSE connection for the whole app: streams execution events and refreshes server data. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data) as LiveEvent;
        setEvents((prev) => (prev.some((p) => p.id === ev.id) ? prev : [ev, ...prev].slice(0, 100)));
        if (!pending.current)
          pending.current = setTimeout(() => {
            pending.current = null;
            router.refresh();
          }, 1500);
      } catch {}
    };
    return () => es.close();
  }, [router]);

  return <Ctx.Provider value={{ events, connected }}>{children}</Ctx.Provider>;
}

export const useLive = () => useContext(Ctx);
