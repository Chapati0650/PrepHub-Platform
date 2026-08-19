import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AbsoluteTimeoutError, SuspectedSleepError, raceAgainstSuspendOrTimeout, watchForSuspend } from "./suspend-detection";

const HEARTBEAT_MS = 5000;

// A controllable stand-in for the Page Visibility API, so tests can simulate
// backgrounding a tab without a real browser. Starts visible, matching a
// freshly-opened tab.
function createFakeVisibility() {
  let hidden = false;
  const handlers = new Set<() => void>();
  return {
    getVisibility: () => (hidden ? ("hidden" as const) : ("visible" as const)),
    onVisibilityChange: (handler: () => void) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    setHidden(next: boolean) {
      hidden = next;
      handlers.forEach((h) => h());
    },
  };
}

describe("watchForSuspend", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("never fires when the clock advances exactly in step with the heartbeat", () => {
    let simulatedNow = 0;
    const onSuspend = vi.fn();
    const stop = watchForSuspend(onSuspend, { now: () => simulatedNow });

    for (let i = 0; i < 10; i++) {
      simulatedNow += HEARTBEAT_MS;
      vi.advanceTimersByTime(HEARTBEAT_MS);
    }

    expect(onSuspend).not.toHaveBeenCalled();
    stop();
  });

  it("does not fire for ordinary scheduling jitter under the drift threshold", () => {
    let simulatedNow = 0;
    const onSuspend = vi.fn();
    const stop = watchForSuspend(onSuspend, { now: () => simulatedNow });

    simulatedNow += HEARTBEAT_MS + 10000; // 10s of drift, under the 20s threshold
    vi.advanceTimersByTime(HEARTBEAT_MS);

    expect(onSuspend).not.toHaveBeenCalled();
    stop();
  });

  it("fires when wall-clock time jumps far more than the heartbeat interval while the tab stays visible (a real suspend)", () => {
    let simulatedNow = 0;
    const onSuspend = vi.fn();
    const stop = watchForSuspend(onSuspend, { now: () => simulatedNow });

    // Simulate the computer sleeping for 2 minutes between two heartbeats —
    // the interval callback only fires once real execution resumes, at
    // which point the injected clock has jumped far ahead of what one
    // HEARTBEAT_MS tick could ever produce on its own.
    simulatedNow += HEARTBEAT_MS + 2 * 60 * 1000;
    vi.advanceTimersByTime(HEARTBEAT_MS);

    expect(onSuspend).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stops watching once the returned cleanup function is called", () => {
    let simulatedNow = 0;
    const onSuspend = vi.fn();
    const stop = watchForSuspend(onSuspend, { now: () => simulatedNow });
    stop();

    simulatedNow += HEARTBEAT_MS + 2 * 60 * 1000;
    vi.advanceTimersByTime(HEARTBEAT_MS);

    expect(onSuspend).not.toHaveBeenCalled();
  });

  // Regression test for a real false positive: an Owner switched browser
  // tabs mid-upload (completely normal usage — the request itself keeps
  // running server-side regardless of tab focus) and got a "suspected
  // sleep" error even though nothing had stalled. Root cause was that
  // Chrome's own background-tab timer throttling delays a backgrounded
  // tab's setInterval — the exact same symptom a real OS suspend produces —
  // so drift observed while hidden must never be treated as suspicious.
  it("does not fire for drift that occurs while the tab is backgrounded (browser timer throttling, not a suspend)", () => {
    let simulatedNow = 0;
    const onSuspend = vi.fn();
    const visibility = createFakeVisibility();
    const stop = watchForSuspend(onSuspend, {
      now: () => simulatedNow,
      getVisibility: visibility.getVisibility,
      onVisibilityChange: visibility.onVisibilityChange,
    });

    visibility.setHidden(true); // user switches to another tab
    // Chrome intensively throttles a backgrounded tab's timers to as
    // infrequently as once a minute — simulate a heartbeat arriving very late.
    simulatedNow += HEARTBEAT_MS + 3 * 60 * 1000;
    vi.advanceTimersByTime(HEARTBEAT_MS);

    expect(onSuspend).not.toHaveBeenCalled();
    stop();
  });

  it("still detects a real suspend that happens after the tab becomes visible again", () => {
    let simulatedNow = 0;
    const onSuspend = vi.fn();
    const visibility = createFakeVisibility();
    const stop = watchForSuspend(onSuspend, {
      now: () => simulatedNow,
      getVisibility: visibility.getVisibility,
      onVisibilityChange: visibility.onVisibilityChange,
    });

    visibility.setHidden(true);
    simulatedNow += HEARTBEAT_MS + 3 * 60 * 1000;
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(onSuspend).not.toHaveBeenCalled(); // background drift ignored, as above

    // Tab comes back to the foreground — the baseline resets, so a normal
    // heartbeat right after doesn't itself look like a suspend.
    visibility.setHidden(false);
    simulatedNow += HEARTBEAT_MS;
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(onSuspend).not.toHaveBeenCalled();

    // Now the computer actually sleeps while the tab is genuinely focused.
    simulatedNow += HEARTBEAT_MS + 2 * 60 * 1000;
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(onSuspend).toHaveBeenCalledTimes(1);

    stop();
  });
});

describe("raceAgainstSuspendOrTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resolves with the original value when the promise settles quickly", async () => {
    await expect(raceAgainstSuspendOrTimeout(Promise.resolve("done"))).resolves.toBe("done");
  });

  it("rejects with the original error when the promise itself rejects", async () => {
    await expect(raceAgainstSuspendOrTimeout(Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });

  it("never rejects merely because the request is slow, as long as no suspend is detected", async () => {
    let resolvePromise!: (value: string) => void;
    const slowPromise = new Promise<string>((resolve) => {
      resolvePromise = resolve;
    });
    const result = raceAgainstSuspendOrTimeout(slowPromise);

    // Let a large amount of *evenly-paced* time pass — the real-world
    // scenario this whole module exists to not misfire on.
    for (let i = 0; i < 100; i++) {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    }

    resolvePromise("finally done");
    await expect(result).resolves.toBe("finally done");
  });

  it("never rejects merely because the tab was backgrounded for a long stretch", async () => {
    const visibility = createFakeVisibility();
    let resolvePromise!: (value: string) => void;
    const slowPromise = new Promise<string>((resolve) => {
      resolvePromise = resolve;
    });
    const result = raceAgainstSuspendOrTimeout(slowPromise, {
      getVisibility: visibility.getVisibility,
      onVisibilityChange: visibility.onVisibilityChange,
    });

    visibility.setHidden(true);
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    }
    visibility.setHidden(false);

    resolvePromise("finally done");
    await expect(result).resolves.toBe("finally done");
  });

  it("rejects with SuspectedSleepError when a real wall-clock suspend is detected", async () => {
    vi.setSystemTime(0);
    const neverResolves = new Promise<never>(() => {});
    const result = raceAgainstSuspendOrTimeout(neverResolves);
    const assertion = expect(result).rejects.toBeInstanceOf(SuspectedSleepError);

    // Jump the wall clock forward without advancing any timers — simulating
    // the OS suspending the whole process — then let the already-scheduled
    // heartbeat fire once "real time" has passed.
    vi.setSystemTime(2 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

    await assertion;
  });

  it("rejects with AbsoluteTimeoutError after the generous backstop elapses with no suspend detected", async () => {
    const neverResolves = new Promise<never>(() => {});
    const result = raceAgainstSuspendOrTimeout(neverResolves);
    const assertion = expect(result).rejects.toBeInstanceOf(AbsoluteTimeoutError);

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1);

    await assertion;
  });
});
