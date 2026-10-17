import type { FocusedDifficulty, QuestionDifficulty } from "@/generated/prisma/client";
import { selectClubQuestions } from "@/lib/club/select-questions";
import { shuffle } from "@/lib/adaptive/random";

export type FocusedCandidate = {
  questionId: string;
  questionRevisionId: string;
  difficulty: QuestionDifficulty;
};

/** Which question difficulties a chosen Focused Practice difficulty draws from. */
export const FOCUSED_DIFFICULTY_POOLS: Record<FocusedDifficulty, readonly QuestionDifficulty[]> = {
  EASY: ["EASY"],
  MEDIUM: ["MEDIUM"],
  HARD: ["HARD"],
  MIXED: ["EASY", "MEDIUM", "HARD"],
};

/**
 * Picks the questions for one Focused Practice session.
 *
 * Reuses the 800 Club's selector for the two rules it already encodes and
 * tests — unseen-first, and never pad — and adds the round-robin deal that
 * 1v1 Rush uses for its MIXED sets, so a MIXED drill can't come out all-Easy
 * just because Easy dominates that category in the bank. When one difficulty
 * runs short the others fill in, which is what stops a thin category from
 * producing a two-question session.
 *
 * Pure: the session row stores its seed, so any selection can be reproduced.
 */
export function selectFocusedQuestions(params: {
  candidates: readonly FocusedCandidate[];
  seenQuestionIds: ReadonlySet<string>;
  difficulty: FocusedDifficulty;
  size: number;
  random: () => number;
}): FocusedCandidate[] {
  const { candidates, seenQuestionIds, difficulty, size, random } = params;
  if (size <= 0) return [];

  // De-duplicate defensively — a caller passing the same question twice must
  // not produce a session that asks it twice.
  const byId = new Map<string, FocusedCandidate>();
  for (const c of candidates) if (!byId.has(c.questionId)) byId.set(c.questionId, c);

  const tiers = FOCUSED_DIFFICULTY_POOLS[difficulty].map((d) => {
    const pool = [...byId.values()].filter((c) => c.difficulty === d);
    return selectClubQuestions({ candidates: pool, seenQuestionIds, size, random }).map(
      (c) => byId.get(c.questionId)!,
    );
  });

  const picked: FocusedCandidate[] = [];
  const cursors = tiers.map(() => 0);
  while (picked.length < size) {
    let dealt = false;
    for (let t = 0; t < tiers.length && picked.length < size; t++) {
      const next = tiers[t][cursors[t]];
      if (!next) continue;
      cursors[t]++;
      picked.push(next);
      dealt = true;
    }
    if (!dealt) break;
  }

  return shuffle(picked, random);
}
