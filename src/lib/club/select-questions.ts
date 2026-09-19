import { shuffle } from "@/lib/adaptive/random";

export type ClubCandidate = { questionId: string; questionRevisionId: string };

// Picks the questions for one 800 Club session. Pure, so the two rules it
// encodes are directly testable:
//
// 1. Unseen first. A question the student has already met in a club session
//    is only reused once every unseen question in the pool has been dealt.
// 2. Never pad. When the pool is smaller than `size`, the session is as long
//    as the pool — a question never appears twice in one session, and there
//    are no placeholder slots.
//
// Order within each tier is seeded-random (the session stores its seed, so a
// selection can be reproduced), and the final list is shuffled again so a
// session that mixes unseen and seen questions doesn't front-load one kind.
export function selectClubQuestions(params: {
  candidates: readonly ClubCandidate[];
  seenQuestionIds: ReadonlySet<string>;
  size: number;
  random: () => number;
}): ClubCandidate[] {
  const { candidates, seenQuestionIds, size, random } = params;
  if (size <= 0 || candidates.length === 0) return [];

  // De-duplicate by questionId defensively — a caller passing a candidate
  // twice must not produce a session that asks it twice.
  const byId = new Map<string, ClubCandidate>();
  for (const c of candidates) if (!byId.has(c.questionId)) byId.set(c.questionId, c);
  const unique = [...byId.values()];

  const unseen = shuffle(
    unique.filter((c) => !seenQuestionIds.has(c.questionId)),
    random,
  );
  const seen = shuffle(
    unique.filter((c) => seenQuestionIds.has(c.questionId)),
    random,
  );

  const picked = [...unseen, ...seen].slice(0, Math.min(size, unique.length));
  return shuffle(picked, random);
}
