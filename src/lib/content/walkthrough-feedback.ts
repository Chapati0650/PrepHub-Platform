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

type FeedbackTotals = {
  questionId: string;
  helpful: number;
  confused: number;
  worstStep: number | null;
  worstStepCount: number | null;
};

/**
 * Every question with feedback, most-confusing first: by the share of
 * answers that said "still confused", then by how many did.
 *
 * Counted in the database, one row per question: this used to load every
 * feedback row ever given and tally them in JavaScript, which grows with
 * every student who finishes a walkthrough. Test accounts are left out by the
 * funnel report's rule (`email NOT LIKE '%example.com%'`), which also catches
 * the demo district (demo-isd.example.com) and load-test students
 * (loadtest.example.com) — the `endsWith("@example.com")` this used missed
 * both. The worst step is the one named most often, the earlier step on a tie.
 */
export async function getWalkthroughFeedbackReport(): Promise<FeedbackRow[]> {
  const totals = await prisma.$queryRaw<FeedbackTotals[]>`
    WITH real_feedback AS (
      SELECT wf."questionId", wf."helpful", wf."confusingStep"
        FROM "walkthrough_feedback" wf
        JOIN "users" u ON u."id" = wf."studentId"
       WHERE u."email" NOT LIKE '%example.com%'
    ),
    per_question AS (
      SELECT "questionId",
             COUNT(*) FILTER (WHERE "helpful")::int     AS helpful,
             COUNT(*) FILTER (WHERE NOT "helpful")::int AS confused
        FROM real_feedback
       GROUP BY "questionId"
    ),
    worst_step AS (
      SELECT DISTINCT ON ("questionId") "questionId", "confusingStep" AS step, COUNT(*)::int AS step_count
        FROM real_feedback
       WHERE "confusingStep" IS NOT NULL
       GROUP BY "questionId", "confusingStep"
       ORDER BY "questionId", COUNT(*) DESC, "confusingStep" ASC
    )
    SELECT p."questionId" AS "questionId", p.helpful, p.confused, w.step AS "worstStep", w.step_count AS "worstStepCount"
      FROM per_question p
      LEFT JOIN worst_step w ON w."questionId" = p."questionId"
  `;
  if (totals.length === 0) return [];
  const questions = await prisma.question.findMany({
    where: { id: { in: totals.map((t) => t.questionId) } },
    select: {
      id: true,
      category: true,
      difficulty: true,
      currentPublishedRevision: { select: { questionText: true } },
    },
  });
  const byId = new Map(totals.map((t) => [t.questionId, t]));
  const report = questions.map((q): FeedbackRow => {
    const entry = byId.get(q.id)!;
    const text = (q.currentPublishedRevision?.questionText ?? "").replace(/\s+/g, " ").trim();
    return {
      questionId: q.id,
      preview: text.length > 110 ? `${text.slice(0, 107)}…` : text,
      category: q.category,
      difficulty: q.difficulty,
      helpful: Number(entry.helpful),
      confused: Number(entry.confused),
      worstStep:
        entry.worstStep === null || entry.worstStepCount === null
          ? null
          : { step: Number(entry.worstStep), count: Number(entry.worstStepCount) },
    };
  });
  return sortFeedbackReport(report);
}

/** Most confusing first: by share of "still confused", then by how many said it. */
export function sortFeedbackReport(report: FeedbackRow[]): FeedbackRow[] {
  const share = (r: FeedbackRow) => r.confused / Math.max(1, r.helpful + r.confused);
  return [...report].sort((a, b) => share(b) - share(a) || b.confused - a.confused);
}
