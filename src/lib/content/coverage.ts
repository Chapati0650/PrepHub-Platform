import { prisma } from "@/lib/prisma";
import type { Prisma, QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { CATEGORY_ORDER, DIFFICULTY_ORDER } from "./constants";

export type CoverageCell = {
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  publishedCount: number;
  draftCount: number;
  missingVideoCount: number;
  missingWrittenExplanationCount: number;
};

const COVERAGE_INCLUDE = {
  currentDraftRevision: { include: { standaloneVideo: true } },
  currentPublishedRevision: { include: { standaloneVideo: true } },
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
        missingWrittenExplanationCount: 0,
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

    const hasWrittenExplanation = Boolean(editableRevision?.writtenExplanation?.trim());
    if (!hasWrittenExplanation) cell.missingWrittenExplanationCount += 1;
  }

  return Array.from(cells.values());
}
