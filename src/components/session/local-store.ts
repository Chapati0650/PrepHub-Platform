/**
 * Per-question scratch work — whiteboard strokes and reading highlights —
 * kept in this browser's localStorage (2026-10-24).
 *
 * Local on purpose: it is a student's own working, like the scrap paper
 * beside a real test. Nobody else needs it, the server never grades it, and
 * a write per pen stroke would be a request per pen stroke. The cost is that
 * it doesn't follow a student to another device, which is also true of paper.
 *
 * Every access is wrapped: storage can be full, disabled (some school
 * Chromebook policies), or throw in a private window, and none of that may
 * break the question the student is answering. Entries carry `savedAt`, and
 * anything a month old is swept the first time either tool opens, so a
 * year of practice doesn't fill a shared machine's quota.
 */

const PREFIX = "prephub:work:";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** A page of dense working is ~60KB; anything far past that is a runaway. */
const MAX_ENTRY_BYTES = 500_000;

type Envelope<T> = { savedAt: number; data: T };

export function readWork<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope<T>;
    return parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeWork<T>(key: string, data: T): void {
  try {
    const raw = JSON.stringify({ savedAt: Date.now(), data } satisfies Envelope<T>);
    if (raw.length > MAX_ENTRY_BYTES) return;
    window.localStorage.setItem(PREFIX + key, raw);
  } catch {
    // Quota or a disabled store: the work stays on screen, it just won't
    // survive a reload.
  }
}

export function removeWork(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    // ignore
  }
}

let swept = false;

/** Drops entries older than a month. Once per page load is plenty. */
export function sweepOldWork(): void {
  if (swept) return;
  swept = true;
  try {
    const cutoff = Date.now() - MAX_AGE_MS;
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) ?? "") as Envelope<unknown>;
        if (!parsed?.savedAt || parsed.savedAt < cutoff) stale.push(key);
      } catch {
        stale.push(key);
      }
    }
    for (const key of stale) window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ---- One-time tips ------------------------------------------------------------
//
// "Has this student seen the tip for X" (2026-10-25: the highlighter went
// unnoticed until someone tried selecting text by accident). Kept apart from
// the work entries above — a different prefix, so the month-old sweep never
// brings a dismissed tip back — and mirrored in memory, so on a Chromebook
// with storage switched off "Got it" still holds for the rest of the visit.

const TIP_PREFIX = "prephub:tip:";
const TIP_EVENT = "prephub:tip";
const seenThisVisit = new Set<string>();

export function hasSeenTip(name: string): boolean {
  if (seenThisVisit.has(name)) return true;
  try {
    return window.localStorage.getItem(TIP_PREFIX + name) === "1";
  } catch {
    return false;
  }
}

export function markTipSeen(name: string): void {
  if (hasSeenTip(name)) return;
  seenThisVisit.add(name);
  try {
    window.localStorage.setItem(TIP_PREFIX + name, "1");
  } catch {
    // Storage blocked: the in-memory mark above is all there is.
  }
  window.dispatchEvent(new Event(TIP_EVENT));
}

/** For useSyncExternalStore: re-read when a tip is marked here or in another tab. */
export function subscribeTips(onChange: () => void): () => void {
  window.addEventListener(TIP_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(TIP_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
