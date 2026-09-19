"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { ONBOARDING_SCORE_RANGES } from "@/lib/onboarding/target-score-options";

// The goal-score step, built as an ascending bar chart the student moves
// along rather than a grid of small text buttons.
//
// Deliberately mapped onto the existing ONBOARDING_SCORE_RANGES rather than a
// free 400-1600 number input: `targetScoreMidpoint` has to be one of those
// range midpoints (or null), because the Predicted Score engine and the
// Progress page's target math are both defined over the same fixed bands
// (`src/lib/score/config.ts`). A continuous slider would look closer to the
// reference but would either feed the engine a midpoint it doesn't recognize
// or silently snap the student's number to a different one.
//
// The chart reads as a goal because height encodes score: bars below the
// chosen one are filled, the chosen one is the dark block, and everything
// above it is a dashed outline — the part you haven't reached yet. That's one
// picture doing what "1290–1360" in a grid cell cannot.
export function GoalScorePicker({
  value,
  onChange,
}: {
  /** undefined = nothing chosen yet, null = "I'm not sure yet". */
  value: number | null | undefined;
  onChange: (midpoint: number | null) => void;
}) {
  const ranges = ONBOARDING_SCORE_RANGES;
  const selectedIndex = value == null ? -1 : ranges.findIndex((r) => r.midpoint === value);
  const selected = selectedIndex >= 0 ? ranges[selectedIndex] : null;

  // With nothing chosen, an arrow press starts from the middle rather than
  // from an end — the student is picking an aspiration, and opening at the
  // bottom of the scale reads as a suggestion that they should.
  const midStart = Math.floor(ranges.length / 2);
  function step(delta: number) {
    const next = selectedIndex < 0 ? midStart : Math.min(Math.max(selectedIndex + delta, 0), ranges.length - 1);
    onChange(ranges[next].midpoint);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div
          className="flex h-40 items-end gap-1.5 sm:h-48 sm:gap-2"
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              step(-1);
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              step(1);
            }
          }}
        >
          {ranges.map((range, i) => {
            const isSelected = i === selectedIndex;
            const isBelow = selectedIndex >= 0 && i < selectedIndex;
            // 34% -> 100% across the band, so the shortest bar is still a bar
            // and not a sliver that's hard to hit.
            const heightPct = 34 + (i / (ranges.length - 1)) * 66;
            return (
              <button
                key={range.index}
                type="button"
                aria-pressed={isSelected}
                aria-label={`Target score ${range.scoreMin} to ${range.scoreMax}`}
                onClick={() => onChange(range.midpoint)}
                style={{ height: `${heightPct}%` }}
                className={[
                  "flex-1 rounded-t-lg transition-all outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  isSelected
                    ? "bg-surface-deep"
                    : isBelow
                      ? "bg-marker"
                      : "border-2 border-dashed border-foreground/20 bg-transparent hover:border-foreground/40",
                ].join(" ")}
              />
            );
          })}
        </div>

        <div className="flex justify-between text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          <span>Min {ranges[0].scoreMin}</span>
          <span>Max {ranges[ranges.length - 1].scoreMax}</span>
        </div>
      </div>

      <div className="flex items-end justify-between gap-6">
        <div>
          <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Your goal</p>
          <p className="mt-1 font-heading text-display-sm font-semibold tracking-tight tabular-nums sm:text-display">
            {selected ? `${selected.scoreMin}–${selected.scoreMax}` : "—"}
          </p>
        </div>

        {/* Arrows as well as direct bar clicks: nudging one band at a time is
            how someone actually converges on a goal, and it gives the step a
            control that works without precise pointing. */}
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            aria-label="Lower target score"
            onClick={() => step(-1)}
            disabled={selectedIndex === 0}
            className="flex size-11 items-center justify-center rounded-full border border-border transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Raise target score"
            onClick={() => step(1)}
            disabled={selectedIndex === ranges.length - 1}
            className="flex size-11 items-center justify-center rounded-full border border-border transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      <button
        type="button"
        aria-pressed={value === null}
        onClick={() => onChange(null)}
        className={[
          "w-fit rounded-full border px-5 py-2.5 text-sm font-medium transition-colors",
          value === null
            ? "border-primary bg-accent text-accent-foreground"
            : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
        ].join(" ")}
      >
        I&apos;m not sure yet
      </button>
    </div>
  );
}
