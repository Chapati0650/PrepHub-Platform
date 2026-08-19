import { prisma } from "@/lib/prisma";
import type {
  Prisma,
  QuestionCategory,
  QuestionDifficulty,
  QuestionType,
} from "@/generated/prisma/client";
import { ContentError } from "./errors";
import { assertPublishable, getPublishIssues } from "./validation";
import { MULTIPLE_CHOICE_OPTION_COUNT, getCalculatorSettingForCategory, getSuggestedTimeForDifficulty } from "./constants";

type Client = typeof prisma | Prisma.TransactionClient;

const REVISION_INCLUDE = {
  answerChoices: { orderBy: { order: "asc" as const } },
  explanationSteps: { orderBy: { order: "asc" as const } },
  standaloneVideo: true,
  questionImage: true,
} satisfies Prisma.QuestionRevisionInclude;

const QUESTION_INCLUDE = {
  currentDraftRevision: { include: REVISION_INCLUDE },
  currentPublishedRevision: { include: REVISION_INCLUDE },
  family: { include: { sharedVideo: true } },
} satisfies Prisma.QuestionInclude;

export type QuestionWithContent = Prisma.QuestionGetPayload<{ include: typeof QUESTION_INCLUDE }>;

export type AnswerChoiceInput = {
  text: string;
  imageId: string | null;
  isCorrect: boolean;
  distractorExplanation?: string | null; // ignored for the correct choice
};
export type ExplanationStepInput = { text: string; imageId: string | null };

export type QuestionContentPatch = Partial<{
  questionText: string;
  questionImageId: string | null;
  writtenExplanation: string | null;
  standaloneVideoId: string | null; // ignored for family questions — family owns the video
  acceptedAnswers: string[]; // OPEN_ENDED_NUMERIC only
  answerChoices: AnswerChoiceInput[]; // MULTIPLE_CHOICE only — must be exactly 4 when provided
  explanationSteps: ExplanationStepInput[]; // richer alternative to writtenExplanation; array order = display order
  category: QuestionCategory; // ignored for family questions — family owns category/difficulty
  difficulty: QuestionDifficulty;
  aiGenerated: boolean; // set once at bulk-upload creation time — see src/lib/content/bulk-upload.ts
  aiAnswerReasoning: string | null;
}>;

// PRD-013 §6.1 requires selecting a question type up front; we also collect
// category/difficulty at creation (rather than allowing them briefly-null) so
// the Questions table's denormalized filter/sort columns are never nullable.
export async function createQuestion(input: {
  questionType: QuestionType;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  sourceImageHash?: string | null;
}): Promise<QuestionWithContent> {
  const questionId = await prisma.$transaction(async (tx) => {
    const question = await tx.question.create({
      data: {
        questionType: input.questionType,
        category: input.category,
        difficulty: input.difficulty,
        sourceImageHash: input.sourceImageHash ?? null,
        status: "DRAFT",
      },
    });
    const revision = await tx.questionRevision.create({
      data: {
        questionId: question.id,
        questionText: "",
        calculatorSetting: getCalculatorSettingForCategory(input.category),
        suggestedTimeSeconds: getSuggestedTimeForDifficulty(input.difficulty),
      },
    });
    if (input.questionType === "MULTIPLE_CHOICE") {
      await tx.questionAnswerChoice.createMany({
        data: Array.from({ length: MULTIPLE_CHOICE_OPTION_COUNT }, (_, order) => ({
          revisionId: revision.id,
          order,
          text: "",
          isCorrect: false,
        })),
      });
    }
    await tx.question.update({ where: { id: question.id }, data: { currentDraftRevisionId: revision.id } });
    return question.id;
  });

  return getQuestionOrThrow(questionId);
}

export async function getQuestionOrThrow(questionId: string): Promise<QuestionWithContent> {
  const question = await prisma.question.findUnique({ where: { id: questionId }, include: QUESTION_INCLUDE });
  if (!question) throw new ContentError("QUESTION_NOT_FOUND", "This question no longer exists.");
  return question;
}

// Bulk-upload's duplicate-detection lookup — see the sourceImageHash field
// comment in schema.prisma. Checked before spending an AI call on an image,
// not after, so re-uploading the exact same file (e.g. after a false
// "Failed" status) costs nothing and creates nothing.
export async function findQuestionIdsByImageHash(hash: string): Promise<string[]> {
  const questions = await prisma.question.findMany({ where: { sourceImageHash: hash }, select: { id: true } });
  return questions.map((q) => q.id);
}

// Second layer of bulk-upload duplicate detection — checked after
// transcription (unlike findQuestionIdsByImageHash above, it needs the
// transcribed text, so it can't run before that one AI call) but before any
// of the more expensive downstream calls (category classification, answer
// detection, explanation generation, distractor generation). Catches what a
// byte-for-byte image hash can't: the same question re-submitted via a
// *different* source file — e.g. an Owner extracting "the pages that
// failed" into a new PDF, whose rendered page images won't necessarily
// match the original file's bytes even when the visual content is
// identical. An exact (trimmed, case-sensitive) match on the full question
// text is deliberately conservative — a prefix or fuzzy match risks merging
// two genuinely different questions that happen to start alike.
export async function findQuestionIdByExactText(questionText: string): Promise<string | null> {
  const text = questionText.trim();
  if (!text) return null;
  const match = await prisma.question.findFirst({
    where: {
      OR: [
        { currentDraftRevision: { questionText: text } },
        { AND: [{ currentDraftRevisionId: null }, { currentPublishedRevision: { questionText: text } }] },
      ],
    },
    select: { id: true },
  });
  return match?.id ?? null;
}

// The revision the Owner is currently authoring: the Draft/Draft-Revision
// content when one exists, otherwise the live Published content (read-only
// until the Owner starts editing it, at which point updateDraftContent clones it).
export function getEditableRevision(question: QuestionWithContent) {
  return question.currentDraftRevision ?? question.currentPublishedRevision;
}

// Standalone questions: by Owner request, an edit to an already-Published
// question now applies directly to the live revision — no Draft Revision
// buffer, no separate Republish step. This overrides PRD-015 §7.2's original
// "existing live content is untouched until Republish" design, which the
// Owner found to be unwanted friction (an extra manual step every time).
// Question Family members are deliberately excluded — see the clone path
// below, still used for them — since a family's atomic publish across all 3
// versions (PRD-015 §8.5) is a separate, more delicate mechanism this change
// doesn't touch.
export async function ensureDraftRevision(tx: Client, question: QuestionWithContent): Promise<string> {
  if (question.currentDraftRevisionId) return question.currentDraftRevisionId;

  const source = question.currentPublishedRevision;
  if (!source) throw new ContentError("REVISION_NOT_FOUND", "This question has no editable content.");

  if (!question.familyId) return source.id;

  const clone = await tx.questionRevision.create({
    data: {
      questionId: question.id,
      questionText: source.questionText,
      questionImageId: source.questionImageId,
      calculatorSetting: source.calculatorSetting,
      suggestedTimeSeconds: source.suggestedTimeSeconds,
      acceptedAnswers: source.acceptedAnswers,
      writtenExplanation: source.writtenExplanation,
      standaloneVideoId: source.standaloneVideoId,
      answerChoices: {
        create: source.answerChoices.map((c) => ({
          order: c.order,
          text: c.text,
          isCorrect: c.isCorrect,
          imageId: c.imageId,
          distractorExplanation: c.distractorExplanation,
        })),
      },
      explanationSteps: {
        create: source.explanationSteps.map((s) => ({
          order: s.order,
          text: s.text,
          imageId: s.imageId,
        })),
      },
    },
  });
  await tx.question.update({
    where: { id: question.id },
    data: { currentDraftRevisionId: clone.id, status: "DRAFT_REVISION" },
  });

  // PRD-015 §8.5: editing any Published family version starts that family's
  // Draft Revision — flag the family so its own status reflects the pending edit,
  // even though only this one member's content actually changed so far.
  if (question.familyId && question.status === "PUBLISHED") {
    await tx.questionFamily.update({
      where: { id: question.familyId },
      data: { status: "DRAFT_REVISION" },
    });
  }

  return clone.id;
}

// The single write path for content edits — the CMS editor's autosave calls
// this with the full current form state on every debounce tick (PRD-015 §6.3).
// Any call resets previewCompletedAt (PRD-015 §5.5: virtually every content
// field resets the mandatory-preview requirement, so we reset unconditionally).
export async function updateDraftContent(
  questionId: string,
  patch: QuestionContentPatch,
): Promise<QuestionWithContent> {
  await prisma.$transaction(async (tx) => {
    const question = await tx.question.findUnique({ where: { id: questionId }, include: QUESTION_INCLUDE });
    if (!question) throw new ContentError("QUESTION_NOT_FOUND", "This question no longer exists.");
    if (question.status === "ARCHIVED") {
      throw new ContentError("NOT_DRAFT", "Archived questions cannot be edited. Restore it first.");
    }

    const revisionId = await ensureDraftRevision(tx, question);
    const isFamilyMember = question.familyId !== null;

    // Calculator access and suggested time are both fixed functions of
    // category/difficulty (see getCalculatorSettingForCategory /
    // getSuggestedTimeForDifficulty), never independent Owner choices —
    // re-derived on every save from whichever category/difficulty is in
    // effect (the patch's incoming value if this call is changing it,
    // otherwise the question's current one) so neither can drift out of sync.
    const effectiveCategory = patch.category ?? question.category;
    const effectiveDifficulty = patch.difficulty ?? question.difficulty;
    const revisionData: Prisma.QuestionRevisionUpdateInput = {
      previewCompletedAt: null,
      calculatorSetting: getCalculatorSettingForCategory(effectiveCategory),
      suggestedTimeSeconds: getSuggestedTimeForDifficulty(effectiveDifficulty),
    };
    if (patch.questionText !== undefined) revisionData.questionText = patch.questionText;
    if (patch.questionImageId !== undefined) {
      revisionData.questionImage = patch.questionImageId
        ? { connect: { id: patch.questionImageId } }
        : { disconnect: true };
    }
    if (patch.writtenExplanation !== undefined) revisionData.writtenExplanation = patch.writtenExplanation;
    if (patch.acceptedAnswers !== undefined) revisionData.acceptedAnswers = patch.acceptedAnswers;
    if (patch.aiGenerated !== undefined) revisionData.aiGenerated = patch.aiGenerated;
    if (patch.aiAnswerReasoning !== undefined) revisionData.aiAnswerReasoning = patch.aiAnswerReasoning;
    if (!isFamilyMember && patch.standaloneVideoId !== undefined) {
      revisionData.standaloneVideo = patch.standaloneVideoId
        ? { connect: { id: patch.standaloneVideoId } }
        : { disconnect: true };
    }

    await tx.questionRevision.update({ where: { id: revisionId }, data: revisionData });

    if (patch.answerChoices !== undefined) {
      if (patch.answerChoices.length !== MULTIPLE_CHOICE_OPTION_COUNT) {
        throw new ContentError(
          "INVALID_INPUT",
          `Multiple-choice questions need exactly ${MULTIPLE_CHOICE_OPTION_COUNT} answer choices.`,
        );
      }
      await tx.questionAnswerChoice.deleteMany({ where: { revisionId } });
      await tx.questionAnswerChoice.createMany({
        data: patch.answerChoices.map((choice, order) => ({
          revisionId,
          order,
          text: choice.text,
          isCorrect: choice.isCorrect,
          imageId: choice.imageId,
          distractorExplanation: choice.isCorrect ? null : (choice.distractorExplanation ?? null),
        })),
      });
    }

    if (patch.explanationSteps !== undefined) {
      await tx.explanationStep.deleteMany({ where: { revisionId } });
      if (patch.explanationSteps.length > 0) {
        await tx.explanationStep.createMany({
          data: patch.explanationSteps.map((step, order) => ({
            revisionId,
            order,
            text: step.text,
            imageId: step.imageId,
          })),
        });
      }
    }

    // Family members don't own category/difficulty — those live on the family
    // and are synced onto every member question when they're assigned (see
    // families.ts) so the Questions table can filter without a join either way.
    if (!isFamilyMember) {
      const questionData: Prisma.QuestionUpdateInput = {};
      if (patch.category !== undefined) questionData.category = patch.category;
      if (patch.difficulty !== undefined) questionData.difficulty = patch.difficulty;
      if (Object.keys(questionData).length > 0) {
        await tx.question.update({ where: { id: questionId }, data: questionData });
      }
    }
  });

  return getQuestionOrThrow(questionId);
}

export async function markPreviewCompleted(questionId: string): Promise<QuestionWithContent> {
  const question = await getQuestionOrThrow(questionId);
  const revision = getEditableRevision(question);
  if (!revision) throw new ContentError("REVISION_NOT_FOUND", "This question has no content to preview.");

  await prisma.questionRevision.update({
    where: { id: revision.id },
    data: { previewCompletedAt: new Date() },
  });
  return getQuestionOrThrow(questionId);
}

// Mirrors markPreviewCompleted: a dedicated write, not routed through
// updateDraftContent, since confirming a review isn't a content edit and
// must not reset previewCompletedAt (see PRD-015 §5.5's "any edit resets
// preview" rule — reviewing already-previewed content shouldn't invalidate it).
export async function markAiReviewed(questionId: string): Promise<QuestionWithContent> {
  const question = await getQuestionOrThrow(questionId);
  const revision = getEditableRevision(question);
  if (!revision) throw new ContentError("REVISION_NOT_FOUND", "This question has no content to review.");

  await prisma.questionRevision.update({
    where: { id: revision.id },
    data: { aiReviewedAt: new Date() },
  });
  return getQuestionOrThrow(questionId);
}

export function getQuestionPublishIssues(question: QuestionWithContent): string[] {
  const revision = getEditableRevision(question);
  if (!revision) return ["This question has no content to publish."];
  return getPublishIssues(question, revision, question.family);
}

// Handles both first-time Publish (from DRAFT) and Republish (from DRAFT_REVISION)
// — the transition is identical: promote the current draft revision to live.
export async function publishQuestion(questionId: string): Promise<QuestionWithContent> {
  const question = await getQuestionOrThrow(questionId);
  if (question.familyId) {
    throw new ContentError(
      "FAMILY_MISMATCH",
      "This question belongs to a Question Family — publish it from the Question Families page.",
    );
  }
  if (question.status !== "DRAFT" && question.status !== "DRAFT_REVISION") {
    throw new ContentError("NOT_DRAFT", "Only a Draft or Draft Revision can be published.");
  }
  const revision = getEditableRevision(question);
  if (!revision) throw new ContentError("REVISION_NOT_FOUND", "This question has no content to publish.");
  assertPublishable(question, revision, question.family);

  const now = new Date();
  await prisma.$transaction([
    prisma.questionRevision.update({ where: { id: revision.id }, data: { publishedAt: now } }),
    prisma.question.update({
      where: { id: questionId },
      data: {
        status: "PUBLISHED",
        publishedAt: now,
        currentPublishedRevisionId: revision.id,
        currentDraftRevisionId: null,
      },
    }),
  ]);
  return getQuestionOrThrow(questionId);
}

// PRD-015 §7.4: unpublishing keeps content editable and preserves it, it just
// stops the question from being live/eligible for new sets. We fold that back
// into DRAFT so the Questions table doesn't need a fifth status value.
export async function unpublishQuestion(questionId: string): Promise<QuestionWithContent> {
  const question = await getQuestionOrThrow(questionId);
  if (question.familyId) {
    throw new ContentError(
      "FAMILY_MISMATCH",
      "This question belongs to a Question Family — unpublish it from the Question Families page.",
    );
  }
  if (question.status !== "PUBLISHED" && question.status !== "DRAFT_REVISION") {
    throw new ContentError("NOT_PUBLISHED", "This question is not currently published.");
  }

  await prisma.question.update({
    where: { id: questionId },
    data: {
      status: "DRAFT",
      publishedAt: null,
      currentPublishedRevisionId: null,
      currentDraftRevisionId: question.currentDraftRevisionId ?? question.currentPublishedRevisionId,
    },
  });
  return getQuestionOrThrow(questionId);
}

export async function archiveQuestion(questionId: string): Promise<QuestionWithContent> {
  const question = await getQuestionOrThrow(questionId);
  if (question.familyId) {
    throw new ContentError(
      "FAMILY_MISMATCH",
      "This question belongs to a Question Family — archive it from the Question Families page.",
    );
  }
  if (question.status === "PUBLISHED" || question.status === "DRAFT_REVISION") {
    throw new ContentError("NOT_ARCHIVABLE", "Unpublish this question before archiving it.");
  }
  if (question.status === "ARCHIVED") return question;

  await prisma.question.update({
    where: { id: questionId },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });
  return getQuestionOrThrow(questionId);
}

export async function restoreQuestion(questionId: string): Promise<QuestionWithContent> {
  const question = await getQuestionOrThrow(questionId);
  if (question.status !== "ARCHIVED") return question;

  await prisma.question.update({
    where: { id: questionId },
    data: { status: "DRAFT", archivedAt: null },
  });
  return getQuestionOrThrow(questionId);
}

// PRD-015 §7.5: never published, no historical references, not in a family.
export async function deleteQuestionPermanently(questionId: string): Promise<void> {
  const question = await getQuestionOrThrow(questionId);
  if (question.publishedAt !== null) {
    throw new ContentError("HAS_REFERENCES", "Published questions can't be permanently deleted — archive it instead.");
  }
  if (question.familyId !== null) {
    throw new ContentError("HAS_REFERENCES", "This question belongs to a Question Family and can't be deleted directly.");
  }
  await prisma.question.delete({ where: { id: questionId } });
}

// PRD-015 §6.6. `intoFamily: true` requests placing the duplicate in the same
// family as the source (only when that family has room); omit/false for a
// standalone duplicate. Family placement is finalized in families.ts because
// it needs to touch QuestionFamily, not just Question — see addExistingDuplicateToFamily.
export async function duplicateQuestionContent(questionId: string): Promise<QuestionWithContent> {
  const source = await getQuestionOrThrow(questionId);
  const sourceRevision = getEditableRevision(source);
  if (!sourceRevision) throw new ContentError("REVISION_NOT_FOUND", "This question has no content to duplicate.");

  const newId = await prisma.$transaction(async (tx) => {
    const question = await tx.question.create({
      data: {
        questionType: source.questionType,
        category: source.category,
        difficulty: source.difficulty,
        status: "DRAFT",
      },
    });
    const revision = await tx.questionRevision.create({
      data: {
        questionId: question.id,
        questionText: sourceRevision.questionText,
        questionImageId: sourceRevision.questionImageId,
        calculatorSetting: sourceRevision.calculatorSetting,
        suggestedTimeSeconds: sourceRevision.suggestedTimeSeconds,
        acceptedAnswers: sourceRevision.acceptedAnswers,
        writtenExplanation: sourceRevision.writtenExplanation,
        standaloneVideoId: source.familyId ? null : sourceRevision.standaloneVideoId,
        answerChoices: {
          create: sourceRevision.answerChoices.map((c) => ({
            order: c.order,
            text: c.text,
            isCorrect: c.isCorrect,
            imageId: c.imageId,
            distractorExplanation: c.distractorExplanation,
          })),
        },
        explanationSteps: {
          create: sourceRevision.explanationSteps.map((s) => ({
            order: s.order,
            text: s.text,
            imageId: s.imageId,
          })),
        },
      },
    });
    await tx.question.update({ where: { id: question.id }, data: { currentDraftRevisionId: revision.id } });
    return question.id;
  });

  return getQuestionOrThrow(newId);
}
