import type { Prisma, QuestionCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createRandom, generateSeed } from "@/lib/adaptive/random";
import { INDIVIDUAL_PRACTICE } from "./config";
import { publishedCandidates, seenPairs } from "./create";
import { planPracticeRun, weakestCategories } from "./practice-plan";

/**
 * Individual practice: one personalized run per student. Slots are the same
 * `GuidedOwnSlot` rows the teacher-led session deals for its own-questions
 * stretch, so answering, feedback and explanations are the existing path, and
 * nothing here touches a student's ability or predicted score.
 */

type SessionForPractice = {
  id: string;
  category: QuestionCategory;
  perStudentSkills: boolean;
  ownQuestionCount: number;
};

/**
 * Deals each student's run (idempotent: a student who has slots is skipped).
 * Chosen before the caller's transaction, written inside it, like
 * `createOwnSlots`.
 */
export async function createPracticeSlots(session: SessionForPractice, studentIds: string[]) {
  const existing = await prisma.guidedOwnSlot.findMany({
    where: { sessionId: session.id, studentId: { in: studentIds } },
    select: { studentId: true },
    distinct: ["studentId"],
  });
  const have = new Set(existing.map((e) => e.studentId));
  const needing = studentIds.filter((id) => !have.has(id));
  if (needing.length === 0) return async () => {};

  const states = await prisma.categoryState.findMany({
    where: { studentId: { in: needing } },
    select: { studentId: true, category: true, ability: true },
  });
  const levels = new Map<string, Partial<Record<QuestionCategory, number>>>(needing.map((id) => [id, {}]));
  for (const s of states) levels.get(s.studentId)![s.category] = s.ability;

  const withQuestions = (
    await prisma.question.groupBy({
      by: ["category"],
      where: { status: "PUBLISHED", currentPublishedRevisionId: { not: null } },
    })
  ).map((g) => g.category);
  const available = session.perStudentSkills ? withQuestions : withQuestions.filter((c) => c === session.category);

  const chosen = new Map<string, QuestionCategory[]>(
    needing.map((id) => [
      id,
      session.perStudentSkills ? weakestCategories(levels.get(id)!, available, INDIVIDUAL_PRACTICE.skillsPerStudent) : available,
    ]),
  );
  const needed = [...new Set([...chosen.values()].flat())];
  const [pools, seenByCategory] = await Promise.all([
    Promise.all(needed.map((c) => publishedCandidates(c))),
    Promise.all(needed.map((c) => seenPairs(needing, c))),
  ]);
  const candidates = new Map(needed.map((c, i) => [c, pools[i]]));
  const random = createRandom(generateSeed());

  const rows: Prisma.GuidedOwnSlotCreateManyInput[] = [];
  for (const studentId of needing) {
    const seenBy = new Map<string, number>();
    for (const seen of seenByCategory) for (const q of seen.get(studentId) ?? []) seenBy.set(q, 1);
    const plan = planPracticeRun({
      categories: chosen.get(studentId)!,
      count: session.ownQuestionCount,
      abilityOf: (c) => levels.get(studentId)![c] ?? null,
      candidates,
      seenBy,
      used: new Set(),
      random,
    });
    plan.forEach((slot, position) =>
      rows.push({
        sessionId: session.id,
        studentId,
        position,
        questionId: slot.candidate.questionId,
        questionRevisionId: slot.candidate.questionRevisionId,
        difficulty: slot.candidate.difficulty,
      }),
    );
  }
  return async (tx: Prisma.TransactionClient) => {
    if (rows.length > 0) await tx.guidedOwnSlot.createMany({ data: rows, skipDuplicates: true });
  };
}
