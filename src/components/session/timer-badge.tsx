"use client";

import { useEffect, useState } from "react";

// PRD-012 §14: measures time spent on the current question and shows a
// noticeable-but-not-alarming notice once the suggested time is reached.
// Never forces submission, never penalizes — display only.
export function TimerBadge({ suggestedTimeSeconds, resetKey }: { suggestedTimeSeconds: number; resetKey: string }) {
  const [elapsed, setElapsed] = useState(0);

  // Restart the clock whenever the question changes, without a setState-in-effect
  // pattern: track the previous resetKey and reset elapsed during render.
  const [trackedKey, setTrackedKey] = useState(resetKey);
  if (trackedKey !== resetKey) {
    setTrackedKey(resetKey);
    setElapsed(0);
  }

  useEffect(() => {
    const interval = setInterval(() => setElapsed((prev) => prev + 1), 1000);
    return () => clearInterval(interval);
  }, [resetKey]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const reached = elapsed >= suggestedTimeSeconds;

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-sm tabular-nums text-muted-foreground" aria-live="off">
        {minutes}:{String(seconds).padStart(2, "0")}
      </span>
      {reached && (
        <span role="status" className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Suggested time reached. You can continue working on this question.
        </span>
      )}
    </div>
  );
}
