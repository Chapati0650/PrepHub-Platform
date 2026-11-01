import { prisma } from "@/lib/prisma";
import type { Prisma, QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { CATEGORY_ORDER, DIFFICULTY_ORDER } from "./constants";

export type CoverageCell = {
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  publishedCount: number;
  draftCount: number;
  missingVideoCount: number;
  missingExplanationCount: number;
};

const REVISION_COVERAGE_INCLUDE = {
  standaloneVideo: true,
  _count: { select: { explanationSteps: true } },
} satisfies Prisma.QuestionRevisionInclude;

const COVERAGE_INCLUDE = {
  currentDraftRevision: { include: REVISION_COVERAGE_INCLUDE },
  currentPublishedRevision: { include: REVISION_COVERAGE_INCLUDE },
  family: { include: { sharedVideo: true } },
} satisfies Prisma.QuestionInclude;

// PRD-015 §11: the question bank isn't expected to reach hundreds of
// thousands of rows, so aggregating in memory over one query is simpler and
// plenty fast, rather than a grouped SQL query per matrix cell.
export async function getContentCoverage(): Promise<CoverageCell[]> {
  const questions = await prisma.question.findMany({
    where: { status: { not: "ARCHIVED" } },
    include: COVERAGE_INCLUDE,
  });

  const cells = new Map<string, CoverageCell>();
  for (const category of CATEGORY_ORDER) {
    for (const difficulty of DIFFICULTY_ORDER) {
      cells.set(`${category}:${difficulty}`, {
        category,
        difficulty,
        publishedCount: 0,
        draftCount: 0,
        missingVideoCount: 0,
        missingExplanationCount: 0,
      });
    }
  }

  for (const question of questions) {
    const cell = cells.get(`${question.category}:${question.difficulty}`);
    if (!cell) continue;

    if (question.status === "PUBLISHED") cell.publishedCount += 1;
    else cell.draftCount += 1; // DRAFT or DRAFT_REVISION

    const editableRevision = question.currentDraftRevision ?? question.currentPublishedRevision;
    const videoReady = question.familyId
      ? question.family?.sharedVideo?.status === "READY"
      : editableRevision?.standaloneVideo?.status === "READY";
    if (!videoReady) cell.missingVideoCount += 1;

    // Either form counts. Bulk upload and the Claude import write the
    // step-by-step explanation and leave the written one empty, so counting
    // only writtenExplanation reported nearly the whole bank as missing one.
    const hasExplanation =
      Boolean(editableRevision?.writtenExplanation?.trim()) || (editableRevision?._count.explanationSteps ?? 0) > 0;
    if (!hasExplanation) cell.missingExplanationCount += 1;
  }

  return Array.from(cells.values());
}
