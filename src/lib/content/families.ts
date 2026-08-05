import { prisma } from "@/lib/prisma";
import type { Prisma, QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { ContentError } from "./errors";
import { FAMILY_ELIGIBLE_CATEGORIES, FAMILY_VERSION_COUNT } from "./constants";
import { assertPublishable } from "./validation";
import {
  duplicateQuestionContent,
  ensureDraftRevision,
  getEditableRevision,
  getQuestionOrThrow,
  type QuestionWithContent,
} from "./questions";

const REVISION_INCLUDE = {
  answerChoices: { orderBy: { order: "asc" as const } },
  standaloneVideo: true,
  questionImage: true,
} satisfies Prisma.QuestionRevisionInclude;

const QUESTION_INCLUDE = {
  currentDraftRevision: { include: REVISION_INCLUDE },
  currentPublishedRevision: { include: REVISION_INCLUDE },
  family: { include: { sharedVideo: true } },
} satisfies Prisma.QuestionInclude;

const FAMILY_INCLUDE = {
  sharedVideo: true,
  questions: { include: QUESTION_INCLUDE },
} satisfies Prisma.QuestionFamilyInclude;

export type QuestionFamilyWithContent = Prisma.QuestionFamilyGetPayload<{ include: typeof FAMILY_INCLUDE }>;

export async function getFamilyOrThrow(familyId: string): Promise<QuestionFamilyWithContent> {
  const family = await prisma.questionFamily.findUnique({ where: { id: familyId }, include: FAMILY_INCLUDE });
  if (!family) throw new ContentError("FAMILY_NOT_FOUND", "This Question Family no longer exists.");
  return family;
}

export async function createEmptyFamily(input: {
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  internalName?: string;
}): Promise<QuestionFamilyWithContent> {
  if (!FAMILY_ELIGIBLE_CATEGORIES.includes(input.category)) {
    throw new ContentError(
      "FAMILY_INELIGIBLE_CATEGORY",
      "Question Families are only available for Algebra, Geometry & Trigonometry, Advanced Math, and Problem Solving & Data Analysis.",
    );
  }
  const family = await prisma.questionFamily.create({
    data: { category: input.category, difficulty: input.difficulty, internalName: input.internalName },
  });
  return getFamilyOrThrow(family.id);
}

// PRD-015 §8.5: replacing the shared video invalidates every member's preview
// completion — if the family is currently live, this also starts a Draft
// Revision (via ensureDraftRevision) rather than mutating live content in place.
export async function setFamilyVideo(familyId: string, mediaAssetId: string | null): Promise<QuestionFamilyWithContent> {
  const family = await getFamilyOrThrow(familyId);

  await prisma.$transaction(async (tx) => {
    for (const question of family.questions) {
      const revisionId =
        question.status === "PUBLISHED"
          ? await ensureDraftRevision(tx, question)
          : (question.currentDraftRevisionId ?? question.currentPublishedRevisionId);
      if (revisionId) {
        await tx.questionRevision.update({ where: { id: revisionId }, data: { previewCompletedAt: null } });
      }
    }
    await tx.questionFamily.update({ where: { id: familyId }, data: { sharedVideoId: mediaAssetId } });
  });

  return getFamilyOrThrow(familyId);
}

export async function updateFamilyDetails(
  familyId: string,
  input: { internalName?: string },
): Promise<QuestionFamilyWithContent> {
  await prisma.questionFamily.update({ where: { id: familyId }, data: { internalName: input.internalName } });
  return getFamilyOrThrow(familyId);
}

function assertEligibleForFamily(question: QuestionWithContent, family: QuestionFamilyWithContent) {
  if (question.status !== "DRAFT") {
    throw new ContentError("FAMILY_MISMATCH", "Only Draft questions can be added to a family.");
  }
  if (question.familyId) {
    throw new ContentError("ALREADY_IN_FAMILY", "This question already belongs to a Question Family.");
  }
  if (!FAMILY_ELIGIBLE_CATEGORIES.includes(question.category)) {
    throw new ContentError(
      "FAMILY_INELIGIBLE_CATEGORY",
      "Only Algebra, Geometry & Trigonometry, Advanced Math, and Problem Solving & Data Analysis questions can join a family.",
    );
  }
  if (question.category !== family.category || question.difficulty !== family.difficulty) {
    throw new ContentError("FAMILY_MISMATCH", "This question's category and difficulty must match the family's.");
  }
  if (family.questions.length >= FAMILY_VERSION_COUNT) {
    throw new ContentError("FAMILY_FULL", `A Question Family can never contain more than ${FAMILY_VERSION_COUNT} versions.`);
  }
}

// PRD-015 §8.3 "Group existing questions" — adds one already-created Draft
// question to an (possibly already partially-filled) family.
export async function addVersionToFamily(familyId: string, questionId: string): Promise<QuestionFamilyWithContent> {
  const [family, question] = await Promise.all([
    getFamilyOrThrow(familyId),
    prisma.question.findUnique({ where: { id: questionId }, include: QUESTION_INCLUDE }),
  ]);
  if (!question) throw new ContentError("QUESTION_NOT_FOUND", "This question no longer exists.");
  assertEligibleForFamily(question, family);

  await prisma.question.update({ where: { id: questionId }, data: { familyId } });
  return getFamilyOrThrow(familyId);
}

// PRD-015 §8.3 "Group existing questions" as a single operation over multiple
// selected Draft questions — creates the family and assigns all of them.
export async function groupExistingQuestionsIntoFamily(input: {
  questionIds: string[];
  internalName?: string;
  sharedVideoId?: string;
}): Promise<QuestionFamilyWithContent> {
  if (input.questionIds.length === 0 || input.questionIds.length > FAMILY_VERSION_COUNT) {
    throw new ContentError("INVALID_INPUT", `Select between 1 and ${FAMILY_VERSION_COUNT} questions to group.`);
  }
  const questions = await prisma.question.findMany({
    where: { id: { in: input.questionIds } },
    include: QUESTION_INCLUDE,
  });
  if (questions.length !== input.questionIds.length) {
    throw new ContentError("QUESTION_NOT_FOUND", "One or more selected questions no longer exist.");
  }
  const [first, ...rest] = questions;
  if (rest.some((q) => q.category !== first.category || q.difficulty !== first.difficulty)) {
    throw new ContentError("FAMILY_MISMATCH", "All selected questions must share the same category and difficulty.");
  }
  if (!FAMILY_ELIGIBLE_CATEGORIES.includes(first.category)) {
    throw new ContentError(
      "FAMILY_INELIGIBLE_CATEGORY",
      "Only Algebra, Geometry & Trigonometry, Advanced Math, and Problem Solving & Data Analysis questions can form a family.",
    );
  }
  for (const q of questions) {
    if (q.status !== "DRAFT") throw new ContentError("FAMILY_MISMATCH", "Only Draft questions can be grouped.");
    if (q.familyId) throw new ContentError("ALREADY_IN_FAMILY", "One or more selected questions already belong to a family.");
  }

  const familyId = await prisma.$transaction(async (tx) => {
    const family = await tx.questionFamily.create({
      data: {
        category: first.category,
        difficulty: first.difficulty,
        internalName: input.internalName,
        sharedVideoId: input.sharedVideoId,
      },
    });
    await tx.question.updateMany({ where: { id: { in: input.questionIds } }, data: { familyId: family.id } });
    return family.id;
  });

  return getFamilyOrThrow(familyId);
}

// PRD-015 §6.6 "Family-question duplication" — only allowed while the family
// has room for another version; otherwise the Owner must duplicate standalone
// (plain duplicateQuestionContent from questions.ts).
export async function duplicateQuestionIntoFamily(questionId: string) {
  const source = await prisma.question.findUnique({ where: { id: questionId }, select: { familyId: true } });
  if (!source) throw new ContentError("QUESTION_NOT_FOUND", "This question no longer exists.");
  if (!source.familyId) throw new ContentError("FAMILY_MISMATCH", "This question is not part of a Question Family.");

  const family = await getFamilyOrThrow(source.familyId);
  if (family.questions.length >= FAMILY_VERSION_COUNT) {
    throw new ContentError(
      "FAMILY_FULL",
      `This family already has ${FAMILY_VERSION_COUNT} versions — duplicate standalone instead.`,
    );
  }

  const duplicate = await duplicateQuestionContent(questionId);
  await prisma.question.update({ where: { id: duplicate.id }, data: { familyId: family.id } });
  return getQuestionOrThrow(duplicate.id);
}

// PRD-015 §8.5: all three versions validate and publish atomically — if any
// version fails validation, none are published.
export async function publishFamily(familyId: string): Promise<QuestionFamilyWithContent> {
  const family = await getFamilyOrThrow(familyId);
  if (family.questions.length !== FAMILY_VERSION_COUNT) {
    throw new ContentError("FAMILY_INCOMPLETE", `This family needs exactly ${FAMILY_VERSION_COUNT} versions to publish.`);
  }
  for (const question of family.questions) {
    const revision = getEditableRevision(question);
    if (!revision) throw new ContentError("REVISION_NOT_FOUND", "One version has no content to publish.");
    assertPublishable(question, revision, family);
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const question of family.questions) {
      const revision = getEditableRevision(question)!;
      await tx.questionRevision.update({ where: { id: revision.id }, data: { publishedAt: now } });
      await tx.question.update({
        where: { id: question.id },
        data: {
          status: "PUBLISHED",
          publishedAt: now,
          currentPublishedRevisionId: revision.id,
          currentDraftRevisionId: null,
        },
      });
    }
    await tx.questionFamily.update({ where: { id: familyId }, data: { status: "PUBLISHED", publishedAt: now } });
  });

  return getFamilyOrThrow(familyId);
}

export async function unpublishFamily(familyId: string): Promise<QuestionFamilyWithContent> {
  const family = await getFamilyOrThrow(familyId);
  if (family.status !== "PUBLISHED" && family.status !== "DRAFT_REVISION") {
    throw new ContentError("NOT_PUBLISHED", "This family is not currently published.");
  }

  await prisma.$transaction(async (tx) => {
    for (const question of family.questions) {
      if (question.status !== "PUBLISHED" && question.status !== "DRAFT_REVISION") continue;
      await tx.question.update({
        where: { id: question.id },
        data: {
          status: "DRAFT",
          publishedAt: null,
          currentPublishedRevisionId: null,
          currentDraftRevisionId: question.currentDraftRevisionId ?? question.currentPublishedRevisionId,
        },
      });
    }
    await tx.questionFamily.update({ where: { id: familyId }, data: { status: "DRAFT", publishedAt: null } });
  });

  return getFamilyOrThrow(familyId);
}

export async function archiveFamily(familyId: string): Promise<QuestionFamilyWithContent> {
  const family = await getFamilyOrThrow(familyId);
  if (family.status === "PUBLISHED" || family.status === "DRAFT_REVISION") {
    throw new ContentError("NOT_ARCHIVABLE", "Unpublish this family before archiving it.");
  }
  if (family.status === "ARCHIVED") return family;

  await prisma.$transaction(async (tx) => {
    await tx.question.updateMany({
      where: { familyId, status: { not: "ARCHIVED" } },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    await tx.questionFamily.update({ where: { id: familyId }, data: { status: "ARCHIVED", archivedAt: new Date() } });
  });

  return getFamilyOrThrow(familyId);
}

export async function restoreFamily(familyId: string): Promise<QuestionFamilyWithContent> {
  const family = await getFamilyOrThrow(familyId);
  if (family.status !== "ARCHIVED") return family;

  await prisma.$transaction(async (tx) => {
    await tx.question.updateMany({
      where: { familyId, status: "ARCHIVED" },
      data: { status: "DRAFT", archivedAt: null },
    });
    await tx.questionFamily.update({ where: { id: familyId }, data: { status: "DRAFT", archivedAt: null } });
  });

  return getFamilyOrThrow(familyId);
}
