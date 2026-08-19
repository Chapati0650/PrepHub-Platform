import { prisma } from "@/lib/prisma";
import type { QuestionDifficulty } from "@/generated/prisma/client";
import { ContentError } from "./errors";
import { classifyQuestionDifficulty } from "./classify-difficulty";
import {
  archiveQuestion,
  deleteQuestionPermanently,
  getEditableRevision,
  getQuestionOrThrow,
  getQuestionPublishIssues,
  publishQuestion,
  unpublishQuestion,
  updateDraftContent,
  type QuestionWithContent,
} from "./questions";

export type BulkResultItem = { questionId: string; ok: boolean; reason?: string };
export type BulkResult = { succeeded: string[]; failed: BulkResultItem[] };

// PRD-015 §10.1: family members are never independently bulk-published — the
// Owner must use the Question Families page for those.
function isFamilyBlocked(question: QuestionWithContent): string | null {
  return question.familyId
    ? "Belongs to a Question Family — publish/unpublish it from the Question Families page."
    : null;
}

async function runBulk(
  questionIds: string[],
  action: (question: QuestionWithContent) => Promise<unknown>,
  precheck?: (question: QuestionWithContent) => string | null,
): Promise<BulkResult> {
  const succeeded: string[] = [];
  const failed: BulkResultItem[] = [];

  for (const questionId of questionIds) {
    try {
      const question = await getQuestionOrThrow(questionId);
      const blockedReason = precheck?.(question);
      if (blockedReason) {
        failed.push({ questionId, ok: false, reason: blockedReason });
        continue;
      }
      await action(question);
      succeeded.push(questionId);
    } catch (err) {
      failed.push({ questionId, ok: false, reason: err instanceof ContentError ? err.message : "Failed." });
    }
  }
  return { succeeded, failed };
}

export async function bulkPublish(questionIds: string[]): Promise<BulkResult> {
  return runBulk(
    questionIds,
    (question) => publishQuestion(question.id),
    (question) => isFamilyBlocked(question) ?? summarizeIssues(getQuestionPublishIssues(question)),
  );
}

export async function bulkUnpublish(questionIds: string[]): Promise<BulkResult> {
  return runBulk(questionIds, (question) => unpublishQuestion(question.id), isFamilyBlocked);
}

export async function bulkArchive(questionIds: string[]): Promise<BulkResult> {
  return runBulk(questionIds, (question) => archiveQuestion(question.id));
}

// Lets an Owner apply a test's own published module structure (e.g. "the
// first 7 Math Module 2 questions are Easy") across many freshly bulk-
// uploaded questions at once, instead of opening each one individually just
// to set this one field. Goes through updateDraftContent — the same path a
// manual per-question edit uses — so suggestedTimeSeconds stays correctly
// derived and, for a Published question, the new difficulty applies
// immediately (see ensureDraftRevision), exactly as any other field change
// would; this never bypasses those rules with a more "direct" update. Family
// members are blocked for the same reason they're blocked from bulk
// publish/unpublish: they don't own their own difficulty, the family does.
export async function bulkSetDifficulty(questionIds: string[], difficulty: QuestionDifficulty): Promise<BulkResult> {
  return runBulk(questionIds, (question) => updateDraftContent(question.id, { difficulty }), isFamilyBlocked);
}

// For content already sitting in the bank (typically pre-dating this
// feature, or hand-authored/uploaded without a known module structure to
// apply via bulkSetDifficulty above) — runs the same AI difficulty estimate
// bulk-upload now uses for new questions, but against each selected
// question's existing content, and sets each one individually rather than
// applying one flat value to the whole selection. Deliberately does not
// touch aiGenerated/aiAnswerReasoning: those track review status for the
// question's original AI-authored content (if any), which this action
// doesn't touch — only difficulty changes.
export async function bulkEstimateDifficulty(questionIds: string[]): Promise<BulkResult> {
  return runBulk(
    questionIds,
    async (question) => {
      const revision = getEditableRevision(question);
      if (!revision) throw new ContentError("REVISION_NOT_FOUND", "This question has no content to evaluate.");
      const result = await classifyQuestionDifficulty({
        questionText: revision.questionText,
        category: question.category,
        questionType: question.questionType,
        answerChoices: question.questionType === "MULTIPLE_CHOICE" ? revision.answerChoices.map((c) => c.text) : null,
      });
      await updateDraftContent(question.id, { difficulty: result.difficulty });
    },
    isFamilyBlocked,
  );
}

export async function bulkDeletePermanently(questionIds: string[]): Promise<BulkResult> {
  return runBulk(questionIds, async (question) => {
    await deleteQuestionPermanently(question.id);
  });
}

function summarizeIssues(issues: string[]): string | null {
  return issues.length > 0 ? issues.join(" ") : null;
}

export async function countArchivable(questionIds: string[]): Promise<number> {
  const questions = await prisma.question.findMany({
    where: { id: { in: questionIds } },
    select: { status: true },
  });
  return questions.filter((q) => q.status === "DRAFT").length;
}
