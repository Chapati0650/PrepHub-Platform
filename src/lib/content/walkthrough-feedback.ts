import { prisma } from "@/lib/prisma";

// "Did this make sense?" at the end of a walkthrough, and the Owner's view of
// the answers: which explanations students say they still don't understand,
// and at which step. One row per student per revision; answering again
// replaces the earlier answer.

export type FeedbackInput = { helpful: boolean; confusingStep: number | null };

/** Records a student's answer for one revision. False when there is no walkthrough there to answer about. */
export async function recordWalkthroughFeedback(studentId: string, questionRevisionId: string, input: FeedbackInput): Promise<boolean> {
  const revision = await prisma.questionRevision.findUnique({
    where: { id: questionRevisionId },
    select: { questionId: true, walkthrough: true, _count: { select: { explanationSteps: true } } },
  });
  if (!revision || revision.walkthrough === null) return false;
  const steps = revision._count.explanationSteps;
  const confusingStep =
    !input.helpful && input.confusingStep !== null && Number.isInteger(input.confusingStep) && input.confusingStep >= 1 && input.confusingStep <= steps
      ? input.confusingStep
      : null;
  await prisma.walkthroughFeedback.upsert({
    where: { studentId_questionRevisionId: { studentId, questionRevisionId } },
    create: { studentId, questionId: revision.questionId, questionRevisionId, helpful: input.helpful, confusingStep },
    update: { helpful: input.helpful, confusingStep },
  });
  return true;
}

export type FeedbackRow = {
  questionId: string;
  preview: string;
  category: string;
  difficulty: string;
  helpful: number;
  confused: number;
  /** The step most often named as where the explanation lost them, with how many named it. */
  worstStep: { step: number; count: number } | null;
};

/**
 * Every question with feedback, most-confusing first: by the share of
 * answers that said "still confused", then by how many did. Test accounts
 * (example.com) are left out, as in every other report.
 */
export async function getWalkthroughFeedbackReport(): Promise<FeedbackRow[]> {
  const rows = await prisma.walkthroughFeedback.findMany({
    where: { student: { email: { not: { endsWith: "@example.com" } } } },
    select: { questionId: true, helpful: true, confusingStep: true },
  });
  const byQuestion = new Map<string, { helpful: number; confused: number; steps: Map<number, number> }>();
  for (const row of rows) {
    const entry = byQuestion.get(row.questionId) ?? { helpful: 0, confused: 0, steps: new Map() };
    if (row.helpful) entry.helpful++;
    else entry.confused++;
    if (row.confusingStep !== null) entry.steps.set(row.confusingStep, (entry.steps.get(row.confusingStep) ?? 0) + 1);
    byQuestion.set(row.questionId, entry);
  }
  if (byQuestion.size === 0) return [];
  const questions = await prisma.question.findMany({
    where: { id: { in: [...byQuestion.keys()] } },
    select: {
      id: true,
      category: true,
      difficulty: true,
      currentPublishedRevision: { select: { questionText: true } },
    },
  });
  const report = questions.map((q): FeedbackRow => {
    const entry = byQuestion.get(q.id)!;
    const worst = [...entry.steps].sort((a, b) => b[1] - a[1])[0];
    const text = (q.currentPublishedRevision?.questionText ?? "").replace(/\s+/g, " ").trim();
    return {
      questionId: q.id,
      preview: text.length > 110 ? `${text.slice(0, 107)}…` : text,
      category: q.category,
      difficulty: q.difficulty,
      helpful: entry.helpful,
      confused: entry.confused,
      worstStep: worst ? { step: worst[0], count: worst[1] } : null,
    };
  });
  const share = (r: FeedbackRow) => r.confused / Math.max(1, r.helpful + r.confused);
  return report.sort((a, b) => share(b) - share(a) || b.confused - a.confused);
}
