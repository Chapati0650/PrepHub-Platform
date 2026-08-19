// A flat "N minutes and give up" timeout is the wrong tool for detecting a
// stalled bulk-upload request: real production logs showed individual
// requests legitimately taking anywhere from under a minute to over 10
// minutes under real (non-stalled) concurrent API load, with no duration
// short enough to reliably catch a genuine stall without *also* misfiring on
// requests that were still actively succeeding — confirmed directly: pages
// reported "Failed" this way kept showing up as newly-created questions in
// the bank moments later.
//
// So instead of guessing at a duration, this watches for what a stall
// actually is: a real gap in wall-clock time, the kind only an OS-level
// suspend (or a fully frozen tab) can produce. A slow-but-working request
// never blocks the JS event loop, so it can never cause the heartbeat below
// to skip a beat — only an actual suspend can.
const HEARTBEAT_MS = 5000;
const DRIFT_THRESHOLD_MS = 20000; // real suspends run seconds-to-minutes; ordinary scheduling jitter never reaches this

type VisibilityState = "visible" | "hidden";

export type WatchForSuspendOptions = {
  now?: () => number;
  // Injectable for tests. Defaults to the real Page Visibility API.
  getVisibility?: () => VisibilityState;
  onVisibilityChange?: (handler: () => void) => () => void;
};

// The heartbeat's own setInterval is, ironically, exactly the kind of timer
// Chrome deliberately delays once a tab has been in the background for a
// few minutes ("intensive timer throttling" — can slow a 5s interval to
// once a minute). That's a completely harmless, expected effect of just
// switching tabs — the underlying fetch/request keeps running fine
// regardless of tab focus — but it produces the exact same symptom this
// module watches for: a heartbeat tick arriving much later than expected.
// Confirmed via a real false positive: an Owner switched tabs mid-upload,
// got a "suspected sleep" error, and the request had actually succeeded.
// So drift is only ever treated as suspicious while the tab was visible
// (foreground) for the entire gap — background drift is expected and
// ignored, and the baseline resets on every visibility change so neither
// the just-finished hidden period nor the moment of switching itself gets
// misread as a suspend on the next tick.
export function watchForSuspend(onSuspend: () => void, options: WatchForSuspendOptions = {}): () => void {
  const now = options.now ?? Date.now;
  const getVisibility =
    options.getVisibility ?? (() => (typeof document !== "undefined" && document.hidden ? "hidden" : "visible"));
  const onVisibilityChange =
    options.onVisibilityChange ??
    ((handler: () => void) => {
      if (typeof document === "undefined") return () => {};
      document.addEventListener("visibilitychange", handler);
      return () => document.removeEventListener("visibilitychange", handler);
    });

  let last = now();
  const timer = setInterval(() => {
    const current = now();
    if (getVisibility() === "visible") {
      const drift = current - last - HEARTBEAT_MS;
      if (drift > DRIFT_THRESHOLD_MS) onSuspend();
    }
    last = current;
  }, HEARTBEAT_MS);

  const stopVisibilityListener = onVisibilityChange(() => {
    last = now();
  });

  return () => {
    clearInterval(timer);
    stopVisibilityListener();
  };
}

// Absolute backstop for a request stuck for a reason *other* than the
// computer sleeping (e.g. a genuine server-side hang) — deliberately very
// generous, since watchForSuspend above is what's meant to catch the common
// real-world case promptly. Also the fallback for a sleep that happens while
// the tab is backgrounded (watchForSuspend deliberately ignores drift then).
export const ABSOLUTE_TIMEOUT_MS = 30 * 60 * 1000;

export class SuspectedSleepError extends Error {
  constructor() {
    super("SUSPECTED_SLEEP");
    this.name = "SuspectedSleepError";
  }
}

export class AbsoluteTimeoutError extends Error {
  constructor() {
    super("TIMED_OUT");
    this.name = "AbsoluteTimeoutError";
  }
}

export function raceAgainstSuspendOrTimeout<T>(promise: Promise<T>, options: WatchForSuspendOptions = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const stopWatching = watchForSuspend(() => settle(() => reject(new SuspectedSleepError())), options);
    const absoluteTimer = setTimeout(() => settle(() => reject(new AbsoluteTimeoutError())), ABSOLUTE_TIMEOUT_MS);

    function settle(fire: () => void) {
      if (settled) return;
      settled = true;
      stopWatching();
      clearTimeout(absoluteTimer);
      fire();
    }

    promise.then(
      (value) => settle(() => resolve(value)),
      (err: unknown) => settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
    );
  });
}
