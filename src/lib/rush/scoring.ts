import {
  RUSH_BASE_POINTS,
  RUSH_GRACE_MS,
  RUSH_SPEED_POINTS,
  RUSH_STREAK_MAX_BONUS,
  RUSH_STREAK_STEP_POINTS,
} from "./config";

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

/**
 * The answer-streak bonus (scoring version 2, 2026-10-24).
 *
 * `streak` counts the correct, in-time answers in a row including this one.
 * The first in a run earns nothing extra; each one after adds another
 * RUSH_STREAK_STEP_POINTS, up to RUSH_STREAK_MAX_BONUS from the sixth on. A
 * wrong answer or a timeout ends the streak, so it rewards consistency rather
 * than speed — the speed bonus already covers that — which is what makes a
 * long run feel like it's building toward something.
 */
export function streakBonus(streak: number): number {
  return Math.min(Math.max(streak - 1, 0) * RUSH_STREAK_STEP_POINTS, RUSH_STREAK_MAX_BONUS);
}

/**
 * How many answers in a row, ending just before `position`, scored points.
 * "Scored points" is the same test as "correct and in time", and it reads the
 * stored rows rather than re-grading, so a streak is always what the student
 * actually saw happen.
 */
export function streakBefore(answers: { position: number; points: number | null }[], position: number): number {
  const byPosition = new Map(answers.map((a) => [a.position, a.points ?? 0]));
  let streak = 0;
  for (let p = position - 1; p >= 0; p--) {
    if ((byPosition.get(p) ?? 0) > 0) streak++;
    else break;
  }
  return streak;
}

export type ScoredAnswer = {
  points: number;
  base: number;
  speed: number;
  streakBonus: number;
  /** The streak after this answer: previous + 1 if it scored, else 0. */
  streak: number;
};

/**
 * Points for one answer under a challenge's scoring version, with the parts
 * broken out so the runner can show where they came from. Version 1 is
 * exactly scoreRushAnswer; version 2 adds the streak bonus on top.
 */
export function scoreRushAnswerWithStreak(params: {
  isCorrect: boolean;
  elapsedMs: number;
  limitMs: number;
  previousStreak: number;
  version: number;
}): ScoredAnswer {
  const total = scoreRushAnswer(params);
  if (total === 0) return { points: 0, base: 0, speed: 0, streakBonus: 0, streak: 0 };
  const streak = params.previousStreak + 1;
  const bonus = params.version >= 2 ? streakBonus(streak) : 0;
  return { points: total + bonus, base: RUSH_BASE_POINTS, speed: total - RUSH_BASE_POINTS, streakBonus: bonus, streak };
}

/** The highest score a run of `size` questions can reach under `version`. */
export function maxRushScore(version: number, size: number): number {
  let max = 0;
  for (let i = 1; i <= size; i++) {
    max += RUSH_BASE_POINTS + RUSH_SPEED_POINTS + (version >= 2 ? streakBonus(i) : 0);
  }
  return max;
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
