import type { QuestionDifficulty, RushDifficulty } from "@/generated/prisma/client";
import { shuffle } from "@/lib/adaptive/random";
import { selectClubQuestions } from "@/lib/club/select-questions";
import { RUSH_DIFFICULTIES } from "./config";

export type RushCandidate = { questionId: string; questionRevisionId: string; difficulty: QuestionDifficulty };

// Picks the ten questions for a rush set. Reuses the 800 Club's selector
// for the two rules it already encodes and tests (unseen-first, never pad),
// and adds one of its own: a MIXED set is dealt round-robin across the
// three difficulties, so it can't come out all-Easy from a bank where Easy
// happens to dominate. When one difficulty runs short the others fill in,
// which is what keeps a small bank from producing a short set.
export function selectRushQuestions(params: {
  candidates: readonly RushCandidate[];
  seenQuestionIds: ReadonlySet<string>;
  difficulty: RushDifficulty;
  size: number;
  random: () => number;
}): RushCandidate[] {
  const { candidates, seenQuestionIds, difficulty, size, random } = params;
  if (size <= 0) return [];

  const byId = new Map<string, RushCandidate>();
  for (const c of candidates) if (!byId.has(c.questionId)) byId.set(c.questionId, c);

  const tiers = RUSH_DIFFICULTIES[difficulty].pool.map((d) => {
    const pool = [...byId.values()].filter((c) => c.difficulty === d);
    return selectClubQuestions({ candidates: pool, seenQuestionIds, size, random }).map((c) => byId.get(c.questionId)!);
  });

  const picked: RushCandidate[] = [];
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
