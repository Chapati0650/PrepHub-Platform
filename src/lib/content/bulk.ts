import { prisma } from "@/lib/prisma";
import { ContentError } from "./errors";
import {
  archiveQuestion,
  deleteQuestionPermanently,
  getQuestionOrThrow,
  getQuestionPublishIssues,
  publishQuestion,
  unpublishQuestion,
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
