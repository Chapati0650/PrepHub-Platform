"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SharedState } from "@/lib/guided/state";
import { STATE_POLL_MS } from "@/lib/guided/config";

/**
 * Polls the room's shared state (there are no WebSockets on this host).
 * Polls never overlap, a failed poll keeps the last good state and says so
 * (`offline`), and polling slows down while the tab is hidden.
 *
 * `skew` is the server's clock minus this device's, from the last answer, so
 * every screen's countdown agrees with the board's whatever the device clock
 * says.
 */
export function useSharedState(stateKey: string, initial: SharedState | null) {
  const [state, setState] = useState<SharedState | null>(initial);
  const [offline, setOffline] = useState(false);
  const [skew, setSkew] = useState(0);
  const nudge = useRef<() => void>(() => {});

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;

    async function poll() {
      if (stopped || running) return;
      running = true;
      try {
        const res = await fetch(`/api/guided/state/${stateKey}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as SharedState;
          if (!stopped) {
            setState(next);
            setSkew(next.serverNow - Date.now());
            setOffline(false);
          }
        } else if (!stopped) {
          setOffline(true);
        }
      } catch {
        if (!stopped) setOffline(true);
      } finally {
        running = false;
        if (!stopped) {
          const delay = document.visibilityState === "hidden" ? STATE_POLL_MS * 4 : STATE_POLL_MS;
          timer = setTimeout(poll, delay);
        }
      }
    }

    nudge.current = () => {
      if (timer) clearTimeout(timer);
      void poll();
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [stateKey]);

  return { state, offline, skew, refresh: () => nudge.current() };
}

/**
 * One shared half-second ticker for every clock on the page. The server
 * snapshot is 0, so clocks render nothing until hydration is done (a time
 * computed on the server would never match the client's).
 */
let tick = 0;
let ticker: ReturnType<typeof setInterval> | null = null;
const tickListeners = new Set<() => void>();
function subscribeNow(listener: () => void) {
  tickListeners.add(listener);
  if (!ticker) {
    tick = Date.now();
    ticker = setInterval(() => {
      tick = Date.now();
      tickListeners.forEach((l) => l());
    }, 500);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}
function getNow() {
  if (!tick) tick = Date.now();
  return tick;
}
const getServerNow = () => 0;

export function useNow(): number {
  return useSyncExternalStore(subscribeNow, getNow, getServerNow);
}

/** Seconds left on the room's clock; null when there is no clock (or before hydration). */
export function useCountdown(endsAt: number | null, skew: number): number | null {
  const now = useNow();
  if (endsAt === null || now === 0) return null;
  return Math.max(0, Math.ceil((endsAt - (now + skew)) / 1000));
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
