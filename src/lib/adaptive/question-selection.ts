import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { pickRandom } from "./random";

export type SelectedQuestion = {
  questionId: string;
  questionRevisionId: string;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  familyId: string | null;
};

// PRD-014 §12.1 — same-category difficulty fallback order, tried before ever
// reallocating to a different category.
const DIFFICULTY_FALLBACK_ORDER: Record<QuestionDifficulty, QuestionDifficulty[]> = {
  EASY: ["EASY", "MEDIUM", "HARD"],
  MEDIUM: ["MEDIUM", "EASY", "HARD"],
  HARD: ["HARD", "MEDIUM", "EASY"],
};

async function loadPublishedCandidates(category: QuestionCategory, difficulty: QuestionDifficulty) {
  return prisma.question.findMany({
    where: { status: "PUBLISHED", category, difficulty },
    select: { id: true, familyId: true, currentPublishedRevisionId: true },
  });
}

// "Previously answered" spans both the diagnostic and adaptive practice —
// PRD-014 §11 Tier 2 is about the exact question, regardless of which flow
// it was answered in. The most recent timestamp per question determines
// "least recently answered" ordering within Tier 2.
async function loadAnsweredTimestamps(studentId: string, questionIds: string[]): Promise<Map<string, Date>> {
  if (questionIds.length === 0) return new Map();
  const [finalized, diagnostic] = await Promise.all([
    prisma.finalizedAttempt.findMany({
      where: { studentId, questionId: { in: questionIds } },
      select: { questionId: true, finalizedAt: true },
    }),
    prisma.diagnosticAttempt.findMany({
      where: {
        questionId: { in: questionIds },
        submittedAt: { not: null },
        diagnosticSession: { studentId },
      },
      select: { questionId: true, submittedAt: true },
    }),
  ]);

  const map = new Map<string, Date>();
  for (const f of finalized) {
    const existing = map.get(f.questionId);
    if (!existing || f.finalizedAt > existing) map.set(f.questionId, f.finalizedAt);
  }
  for (const d of diagnostic) {
    if (!d.submittedAt) continue;
    const existing = map.get(d.questionId);
    if (!existing || d.submittedAt > existing) map.set(d.questionId, d.submittedAt);
  }
  return map;
}

// Selects one question for a single (category, difficulty) target, applying
// the §12.1 same-category difficulty fallback order and the §11 Tier 1/Tier 2
// selection rules at every difficulty level tried. Returns null if no
// eligible published question exists at any fallback difficulty within the
// category — the caller is then responsible for §12.2 category reallocation.
export async function selectQuestionForSlot(params: {
  studentId: string;
  plannedCategory: QuestionCategory;
  plannedDifficulty: QuestionDifficulty;
  excludeQuestionIds: ReadonlySet<string>;
  excludeFamilyIds: ReadonlySet<string>;
  random: () => number;
}): Promise<SelectedQuestion | null> {
  const difficultyOrder = DIFFICULTY_FALLBACK_ORDER[params.plannedDifficulty];

  for (const difficulty of difficultyOrder) {
    const candidates = await loadPublishedCandidates(params.plannedCategory, difficulty);
    const eligible = candidates.filter(
      (c) =>
        !params.excludeQuestionIds.has(c.id) &&
        (c.familyId === null || !params.excludeFamilyIds.has(c.familyId)) &&
        c.currentPublishedRevisionId !== null,
    );
    if (eligible.length === 0) continue;

    const answered = await loadAnsweredTimestamps(
      params.studentId,
      eligible.map((c) => c.id),
    );
    const tier1 = eligible.filter((c) => !answered.has(c.id));

    let chosen: (typeof eligible)[number];
    if (tier1.length > 0) {
      chosen = pickRandom(tier1, params.random);
    } else {
      const tier2 = eligible;
      const oldestTimestamp = Math.min(...tier2.map((c) => answered.get(c.id)!.getTime()));
      const oldestCandidates = tier2.filter((c) => answered.get(c.id)!.getTime() === oldestTimestamp);
      chosen = pickRandom(oldestCandidates, params.random);
    }

    return {
      questionId: chosen.id,
      questionRevisionId: chosen.currentPublishedRevisionId!,
      category: params.plannedCategory,
      difficulty,
      familyId: chosen.familyId,
    };
  }

  return null;
}
