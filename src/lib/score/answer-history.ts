import type { Prisma } from "@/generated/prisma/client";
import { diagnosticAnswers, type ScoredAnswer } from "@/lib/adaptive/estimate";

type Client = Pick<Prisma.TransactionClient, "diagnosticAttempt" | "finalizedAttempt">;

/**
 * Every answer a student's abilities are estimated from (the Diagnostic's
 * served answers and all Practice Set answers), which is what the prediction's
 * band is computed from. Same reads as completePracticeSet's re-estimate.
 */
export async function loadAnswerHistory(
  client: Client,
  studentId: string,
): Promise<{ diagnostic: ScoredAnswer[]; practice: ScoredAnswer[] }> {
  const [diagnosticAttempts, practiceAnswers] = await Promise.all([
    client.diagnosticAttempt.findMany({
      where: { diagnosticSession: { studentId } },
      select: { category: true, difficulty: true, isCorrect: true, submittedAt: true, waivedAt: true },
    }),
    client.finalizedAttempt.findMany({ where: { studentId }, select: { category: true, difficulty: true, isCorrect: true } }),
  ]);
  return {
    diagnostic: diagnosticAnswers(diagnosticAttempts),
    practice: practiceAnswers.map((a) => ({ category: a.category, difficulty: a.difficulty, isCorrect: !!a.isCorrect })),
  };
}
