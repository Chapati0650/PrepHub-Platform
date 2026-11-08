import { POINT_SCORING_VERSIONS } from "./config";

/** How a stored prediction is shown: a point with a likely band (2026.3 on), or just the old range. */
export type PredictionView = { min: number; max: number; point: number | null };

type StoredDisplay = {
  scoringEngineVersion: string;
  displayedRangeMinimum: number;
  displayedRangeMaximum: number;
  representativeMidpoint: number;
};

export function hasPointEstimate(scoringEngineVersion: string): boolean {
  return POINT_SCORING_VERSIONS.includes(scoringEngineVersion);
}

/**
 * Reads one stored entry by its own version's rules: 2026.3 stores the score
 * in representativeMidpoint and its likely band in the range columns; earlier
 * versions stored only one of fifteen ranges.
 */
export function predictionView(entry: StoredDisplay): PredictionView {
  return {
    min: entry.displayedRangeMinimum,
    max: entry.displayedRangeMaximum,
    point: hasPointEstimate(entry.scoringEngineVersion) ? entry.representativeMidpoint : null,
  };
}

/** "1240 (likely 1190–1290)", or "1130–1200" for an entry from before 2026.3. */
export function predictionText(view: PredictionView): string {
  return view.point === null ? `${view.min}–${view.max}` : `${view.point} (likely ${view.min}–${view.max})`;
}

/** The single number to compare or measure against a target. */
export function predictionCenter(view: PredictionView): number {
  return view.point ?? (view.min + view.max) / 2;
}
