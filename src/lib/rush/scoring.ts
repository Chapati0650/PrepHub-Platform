import { RUSH_BASE_POINTS, RUSH_GRACE_MS, RUSH_SPEED_POINTS } from "./config";

// Points for one answer. Pure — the only arithmetic in the feature, so it
// gets the unit tests. `elapsedMs` is measured on the server (servedAt →
// answeredAt), never taken from the client.
export function scoreRushAnswer(params: { isCorrect: boolean; elapsedMs: number; limitMs: number }): number {
  const { isCorrect, elapsedMs, limitMs } = params;
  if (!isCorrect) return 0;
  if (isOverLimit(elapsedMs, limitMs)) return 0;
  const remaining = Math.min(1, Math.max(0, (limitMs - elapsedMs) / limitMs));
  return RUSH_BASE_POINTS + Math.round(RUSH_SPEED_POINTS * remaining);
}

export function isOverLimit(elapsedMs: number, limitMs: number): boolean {
  return elapsedMs > limitMs + RUSH_GRACE_MS;
}

export type RushOutcome = "WON" | "LOST" | "TIED";

// Head-to-head outcome from the viewer's perspective. Score first; on a tie,
// the faster total time wins; a tie on both is a tie.
export function compareRuns(
  mine: { score: number; totalMs: number },
  theirs: { score: number; totalMs: number },
): RushOutcome {
  if (mine.score !== theirs.score) return mine.score > theirs.score ? "WON" : "LOST";
  if (mine.totalMs !== theirs.totalMs) return mine.totalMs < theirs.totalMs ? "WON" : "LOST";
  return "TIED";
}
