import type { ClubSection, Prisma, RushDifficulty, RushMode } from "@/generated/prisma/client";
import { createRandom, generateSeed } from "@/lib/adaptive/random";
import { RUSH_DIFFICULTIES, RUSH_RUN_SIZE, RUSH_SECTIONS } from "./config";
import { selectRushQuestions } from "./select-questions";
import { generateRushCode } from "./codes";
import { RushError } from "./errors";

// Shared by the async paths (runs.ts) and live rooms (live.ts): a set of
// ten pinned revisions, and a challenge with a fresh join code.

export async function createSet(studentId: string, section: ClubSection, difficulty: RushDifficulty, tx: Prisma.TransactionClient) {
  const [candidates, seen] = await Promise.all([
    tx.question.findMany({
      where: {
        status: "PUBLISHED",
        difficulty: { in: [...RUSH_DIFFICULTIES[difficulty].pool] },
        category: { in: [...RUSH_SECTIONS[section].categories] },
        currentPublishedRevisionId: { not: null },
      },
      select: { id: true, difficulty: true, currentPublishedRevisionId: true },
    }),
    // Every question in a set this student has a run in — seen or about to
    // be — so a new set avoids it while unseen questions remain.
    tx.rushSlot.findMany({
      where: { set: { challenges: { some: { runs: { some: { studentId } } } } } },
      select: { questionId: true },
      distinct: ["questionId"],
    }),
  ]);
  const seenIds = new Set(seen.map((s) => s.questionId));

  const randomSeed = generateSeed();
  const picked = selectRushQuestions({
    candidates: candidates.map((c) => ({ questionId: c.id, questionRevisionId: c.currentPublishedRevisionId!, difficulty: c.difficulty })),
    seenQuestionIds: seenIds,
    difficulty,
    size: RUSH_RUN_SIZE,
    random: createRandom(randomSeed),
  });
  if (picked.length === 0) throw new RushError("NO_QUESTIONS", "There aren't enough questions for that rush yet. Try another section or difficulty.");

  return tx.rushSet.create({
    data: {
      section,
      difficulty,
      randomSeed,
      slots: { create: picked.map((p, position) => ({ position, questionId: p.questionId, questionRevisionId: p.questionRevisionId })) },
    },
    select: { id: true },
  });
}

// A fresh code per challenge; the unique index catches the one-in-a-billion
// collision and we simply draw again.
export async function createChallenge(
  tx: Prisma.TransactionClient,
  data: { setId: string; mode: RushMode; creatorId: string; live?: boolean; liveStatus?: "WAITING" },
): Promise<{ id: string; code: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRushCode();
    try {
      return await tx.rushChallenge.create({ data: { ...data, code }, select: { id: true, code: true } });
    } catch (err) {
      if (attempt === 4 || !isUniqueViolation(err)) throw err;
    }
  }
  throw new Error("unreachable");
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
}

