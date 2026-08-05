import {
  FOCUS_RECENCY_MAX,
  FOCUS_RECENCY_PRIORITY_WEIGHT,
  FOCUS_RECENCY_POINTS_PER_SET,
  RECENT_STRUGGLE_PRIORITY_WEIGHT,
  WEAKNESS_PRIORITY_WEIGHT,
  clamp,
} from "./config";

// PRD-014 §7.1
export function weaknessScore(ability: number): number {
  return 100 - ability;
}

// PRD-014 §7.2 — measures whether the student performed *worse than expected*
// over their most recent adaptive answers in the category (not raw accuracy).
// `recentAnswers` must already be limited to the most recent RECENT_PERFORMANCE_WINDOW
// (5) finalized adaptive-practice answers, oldest-first or any order — order
// doesn't matter since this is a plain average — with diagnostic answers excluded.
export function recentStruggleScore(recentAnswers: { expectedProbability: number; isCorrect: boolean }[]): number {
  if (recentAnswers.length === 0) return 0;
  const sum = recentAnswers.reduce((acc, a) => acc + (a.expectedProbability - (a.isCorrect ? 1 : 0)), 0);
  const raw = 100 * (sum / recentAnswers.length);
  return clamp(raw, 0, 100);
}

// PRD-014 §7.3
export function focusRecencyScore(consecutiveSetsWithoutExtraAllocation: number): number {
  return Math.min(FOCUS_RECENCY_POINTS_PER_SET * consecutiveSetsWithoutExtraAllocation, FOCUS_RECENCY_MAX);
}

// PRD-014 §7.4
export function priorityScore(weakness: number, struggle: number, focus: number): number {
  return WEAKNESS_PRIORITY_WEIGHT * weakness + RECENT_STRUGGLE_PRIORITY_WEIGHT * struggle + FOCUS_RECENCY_PRIORITY_WEIGHT * focus;
}
