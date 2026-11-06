import type { QuestionDifficulty } from "@/generated/prisma/client";
import { expectedProbability } from "@/lib/adaptive/ability";
import { DIFFICULTY_RATING } from "@/lib/adaptive/config";
import { MOVE_ON_ABOVE, TALK_FROM } from "./config";

/**
 * How hard each of the session's class questions should be. Pure.
 *
 * - **Start**: one most of the class should get alone, so the session opens
 *   with a win (students who drop out of a session usually do it in the first
 *   few questions). The hardest tier the class's middle student still gets
 *   right at least 70% of the time.
 * - **Discuss**: about half should get it alone, the range where talking it
 *   over helps most (Crouch & Mazur 2001).
 * - **Stretch**: one tier harder. Most of the room is expected to miss it;
 *   that is where the teacher's explanation and a question like it do the
 *   teaching.
 *
 * The chance is the adaptive engine's own estimate for the class's middle
 * student. It is a starting guess: the first vote decides what happens next.
 */

export type ClassQuestionRole = "START" | "DISCUSS" | "STRETCH";
export type PlannedQuestion = { role: ClassQuestionRole; difficulty: QuestionDifficulty; chance: number | null };

const TIERS: QuestionDifficulty[] = ["EASY", "MEDIUM", "HARD"];

export function chanceFor(difficulty: QuestionDifficulty, ability: number): number {
  return expectedProbability(DIFFICULTY_RATING[difficulty], ability);
}

export function harderTier(difficulty: QuestionDifficulty): QuestionDifficulty {
  return TIERS[Math.min(TIERS.indexOf(difficulty) + 1, TIERS.length - 1)];
}

/** Difficulties to try, in order, when a tier has no questions left. */
export function tierFallback(difficulty: QuestionDifficulty): QuestionDifficulty[] {
  if (difficulty === "EASY") return ["EASY", "MEDIUM", "HARD"];
  if (difficulty === "HARD") return ["HARD", "MEDIUM", "EASY"];
  return ["MEDIUM", "EASY", "HARD"];
}

/** The tier a confident start uses: the hardest one still clearing the move-on bar. */
export function startTier(ability: number | null): QuestionDifficulty {
  if (ability === null) return "EASY";
  const clearing = TIERS.filter((d) => chanceFor(d, ability) >= MOVE_ON_ABOVE);
  return clearing.length > 0 ? clearing[clearing.length - 1] : "EASY";
}

/** The tier whose chance is closest to an even split. */
export function discussTier(ability: number | null): QuestionDifficulty {
  if (ability === null) return "MEDIUM";
  let best: QuestionDifficulty = "MEDIUM";
  let bestGap = Infinity;
  for (const d of TIERS) {
    const gap = Math.abs(chanceFor(d, ability) - 0.5);
    if (gap < bestGap) {
      best = d;
      bestGap = gap;
    }
  }
  return best;
}

export function planClassQuestions(medianAbility: number | null, count: number): PlannedQuestion[] {
  const chance = (d: QuestionDifficulty) => (medianAbility === null ? null : chanceFor(d, medianAbility));
  const start = startTier(medianAbility);
  const discuss = discussTier(medianAbility);
  const stretch = harderTier(discuss);

  const roles: ClassQuestionRole[] =
    count <= 1 ? ["DISCUSS"] : count === 2 ? ["START", "DISCUSS"] : count === 3 ? ["START", "DISCUSS", "STRETCH"] : ["START", "DISCUSS", "DISCUSS", "STRETCH"];
  return roles.slice(0, Math.max(count, 1)).map((role) => {
    const difficulty = role === "START" ? start : role === "DISCUSS" ? discuss : stretch;
    return { role, difficulty, chance: chance(difficulty) };
  });
}

/** What the board suggests after a first vote. */
export type SuggestedMove = "MOVE_ON" | "TALK" | "EXPLAIN";

export function suggestMove(rightShare: number | null): SuggestedMove | null {
  if (rightShare === null) return null;
  if (rightShare > MOVE_ON_ABOVE) return "MOVE_ON";
  if (rightShare >= TALK_FROM) return "TALK";
  return "EXPLAIN";
}
