import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { shuffle } from "@/lib/adaptive/random";
import { sampleDifficulty } from "@/lib/adaptive/difficulty";
import { harderTier, tierFallback } from "./plan";

/**
 * Choosing questions. Pure, so the two rules are tested directly:
 *
 * 1. **Fewest eyes first.** A question half the room remembers from homework
 *    won't split the room, so a class question is the one the fewest students
 *    in the class have answered before; ties are broken at random.
 * 2. **Never stuck on a thin tier.** Content is uneven (some skills have two
 *    easy questions), so when a difficulty runs out the next nearest is used
 *    rather than leaving a slot empty.
 */

export type Candidate = {
  questionId: string;
  questionRevisionId: string;
  difficulty: QuestionDifficulty;
  /** Explanation steps on the published revision. A worked example needs some. */
  stepCount: number;
};

export function rankByFreshness(
  candidates: readonly Candidate[],
  seenBy: ReadonlyMap<string, number>,
  random: () => number,
): Candidate[] {
  // Shuffle first; the sort is stable, so equal counts keep the random order.
  return shuffle([...candidates], random).sort((a, b) => (seenBy.get(a.questionId) ?? 0) - (seenBy.get(b.questionId) ?? 0));
}

/**
 * One question at `difficulty` (or the nearest tier that has one), not in
 * `used`. `needsSteps` asks for a question with at least two explanation
 * steps, for a worked example, and falls back to any if none has them.
 */
export function chooseQuestion(params: {
  candidates: readonly Candidate[];
  difficulty: QuestionDifficulty;
  used: ReadonlySet<string>;
  seenBy: ReadonlyMap<string, number>;
  random: () => number;
  needsSteps?: boolean;
}): Candidate | null {
  const { candidates, difficulty, used, seenBy, random, needsSteps = false } = params;
  const open = candidates.filter((c) => !used.has(c.questionId));
  for (const requireSteps of needsSteps ? [true, false] : [false]) {
    for (const tier of tierFallback(difficulty)) {
      const pool = open.filter((c) => c.difficulty === tier && (!requireSteps || c.stepCount >= 2));
      if (pool.length > 0) return rankByFreshness(pool, seenBy, random)[0];
    }
  }
  return null;
}

/**
 * A student's own questions: the same draw the adaptive engine uses for
 * Practice Sets (harder questions as the student's level rises), and Medium
 * for a student with no Diagnostic yet.
 */
export function ownDifficulties(
  category: QuestionCategory,
  ability: number | null,
  count: number,
  random: () => number,
): QuestionDifficulty[] {
  return Array.from({ length: count }, () => (ability === null ? "MEDIUM" : sampleDifficulty(ability, category, random)));
}

/** The bonus question is a step up from the hardest of the student's own. */
export function bonusDifficulty(own: readonly QuestionDifficulty[]): QuestionDifficulty {
  const order: QuestionDifficulty[] = ["EASY", "MEDIUM", "HARD"];
  const hardest = own.reduce<QuestionDifficulty>((h, d) => (order.indexOf(d) > order.indexOf(h) ? d : h), "EASY");
  return harderTier(hardest);
}
