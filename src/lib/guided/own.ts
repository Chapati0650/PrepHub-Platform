import type { Prisma, QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createRandom, generateSeed } from "@/lib/adaptive/random";
import { publishedCandidates, seenPairs } from "./create";
import { bonusDifficulty, chooseQuestion, ownDifficulties } from "./select";

type SessionForOwn = {
  id: string;
  category: QuestionCategory;
  ownQuestionCount: number;
  items: { questionId: string }[];
};

/**
 * Each student's own questions, chosen before a transaction and written
 * inside it (the caller's): same skill as the session, at the student's
 * level, ones they haven't seen first, never one the room just did.
 * Idempotent on (session, student, position), so a student who already has
 * theirs is skipped.
 */
export async function createOwnSlots(session: SessionForOwn, studentIds: string[]) {
  const existing = await prisma.guidedOwnSlot.findMany({
    where: { sessionId: session.id, studentId: { in: studentIds } },
    select: { studentId: true },
    distinct: ["studentId"],
  });
  const have = new Set(existing.map((e) => e.studentId));
  const needing = studentIds.filter((id) => !have.has(id));
  if (needing.length === 0) return async () => {};

  const [candidates, seen, abilities] = await Promise.all([
    publishedCandidates(session.category),
    seenPairs(needing, session.category),
    prisma.categoryState.findMany({
      where: { studentId: { in: needing }, category: session.category },
      select: { studentId: true, ability: true },
    }),
  ]);
  const abilityOf = new Map(abilities.map((a) => [a.studentId, a.ability]));
  const sessionQuestions = session.items.map((i) => i.questionId);
  const random = createRandom(generateSeed());

  const rows: Prisma.GuidedOwnSlotCreateManyInput[] = [];
  for (const studentId of needing) {
    const used = new Set(sessionQuestions);
    const seenBy = new Map([...(seen.get(studentId) ?? [])].map((id) => [id, 1]));
    const difficulties = ownDifficulties(session.category, abilityOf.get(studentId) ?? null, session.ownQuestionCount, random);
    let position = 0;
    for (const difficulty of difficulties) {
      const pick = chooseQuestion({ candidates, difficulty, used, seenBy, random });
      if (!pick) break;
      used.add(pick.questionId);
      rows.push({
        sessionId: session.id,
        studentId,
        position: position++,
        questionId: pick.questionId,
        questionRevisionId: pick.questionRevisionId,
        difficulty: pick.difficulty,
      });
    }
  }
  return async (tx: Prisma.TransactionClient) => {
    if (rows.length > 0) await tx.guidedOwnSlot.createMany({ data: rows, skipDuplicates: true });
  };
}

/** The optional extra question for a student who finished early: a step harder. */
export async function createBonusSlot(session: SessionForOwn, studentId: string): Promise<boolean> {
  const own = await prisma.guidedOwnSlot.findMany({
    where: { sessionId: session.id, studentId },
    select: { questionId: true, difficulty: true, bonus: true, position: true },
  });
  if (own.some((s) => s.bonus)) return true;
  const [candidates, seen] = await Promise.all([publishedCandidates(session.category), seenPairs([studentId], session.category)]);
  const difficulties: QuestionDifficulty[] = own.map((s) => s.difficulty);
  const pick = chooseQuestion({
    candidates,
    difficulty: bonusDifficulty(difficulties.length > 0 ? difficulties : ["MEDIUM"]),
    used: new Set([...session.items.map((i) => i.questionId), ...own.map((s) => s.questionId)]),
    seenBy: new Map([...(seen.get(studentId) ?? [])].map((id) => [id, 1])),
    random: createRandom(generateSeed()),
  });
  if (!pick) return false;
  await prisma.guidedOwnSlot.createMany({
    data: [
      {
        sessionId: session.id,
        studentId,
        position: own.length,
        bonus: true,
        questionId: pick.questionId,
        questionRevisionId: pick.questionRevisionId,
        difficulty: pick.difficulty,
      },
    ],
    skipDuplicates: true,
  });
  return true;
}
