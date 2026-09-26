import { useEffect, useRef } from "react";
import { api } from "./api";

export type LiveType = "catalog" | "config" | "cart" | "me" | "order" | "orders" | "users" | "resync";

export interface LiveEvent {
  type: LiveType;
  number?: number;
}

type Listener = (e: LiveEvent) => void;

const listeners = new Set<Listener>();

function emit(e: LiveEvent) {
  for (const fn of listeners) fn(e);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startLive(): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let connectedOnce = false;
  let delay = 1000;

  const run = async () => {
    while (!stopped) {
      controller = new AbortController();
      try {
        const res = await api.stream("/events", controller.signal);
        if (!res.ok || !res.body) throw new Error(String(res.status));
        if (connectedOnce) emit({ type: "resync" });
        connectedOnce = true;
        delay = 1000;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const line = block.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            try {
              emit(JSON.parse(line.slice(6)) as LiveEvent);
            } catch {
              continue;
            }
          }
        }
      } catch {
        if (stopped) return;
      }
      if (stopped) return;
      await sleep(delay + Math.random() * 500);
      delay = Math.min(delay * 2, 30_000);
    }
  };

  const onVisible = () => {
    if (document.visibilityState === "visible" && connectedOnce) emit({ type: "resync" });
  };
  document.addEventListener("visibilitychange", onVisible);
  void run();

  return () => {
    stopped = true;
    controller?.abort();
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export function useLive(match: LiveType[] | ((e: LiveEvent) => boolean), fn: (e: LiveEvent) => void) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const matchRef = useRef(match);
  matchRef.current = match;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener: Listener = (e) => {
      const m = matchRef.current;
      const ok = e.type === "resync" || (typeof m === "function" ? m(e) : m.includes(e.type));
      if (!ok) return;
      clearTimeout(timer);
      timer = setTimeout(() => fnRef.current(e), 250);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      clearTimeout(timer);
    };
  }, []);
}
