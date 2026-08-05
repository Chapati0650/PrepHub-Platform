import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { pickRandom } from "@/lib/adaptive/random";

export type SelectedDiagnosticQuestion = { questionId: string; questionRevisionId: string };

// PRD-012 §10/§11 — the diagnostic needs exactly one published question per
// (category, difficulty), with no fallback to an adjacent difficulty (unlike
// PRD-014's adaptive selection): a missing pool is a hard generation failure,
// not something to substitute around.
export async function selectDiagnosticQuestion(params: {
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  excludeQuestionIds: ReadonlySet<string>;
  random: () => number;
}): Promise<SelectedDiagnosticQuestion | null> {
  const candidates = await prisma.question.findMany({
    where: { status: "PUBLISHED", category: params.category, difficulty: params.difficulty },
    select: { id: true, currentPublishedRevisionId: true },
  });
  const eligible = candidates.filter((c) => !params.excludeQuestionIds.has(c.id) && c.currentPublishedRevisionId !== null);
  if (eligible.length === 0) return null;

  const chosen = pickRandom(eligible, params.random);
  return { questionId: chosen.id, questionRevisionId: chosen.currentPublishedRevisionId! };
}
