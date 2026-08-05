import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { computeAbilityUpdate } from "./ability";
import { ENGINE_VERSION } from "./config";
import { AdaptiveError } from "./errors";
import { isAnswerCorrect } from "./grading";

// PRD-014 §16 / §17 — finalizing an answer and updating ability must be
// atomic and idempotent: a retried request must not apply the same Ability
// Score change twice. The unique FinalizedAttempt.blueprintSlotId constraint
// is the DB-level backstop against a concurrent double-submit race; the
// upfront check is the fast path for the ordinary retry case.
export async function finalizeAnswer(params: { studentId: string; blueprintSlotId: string; answer: string | null; isBlank: boolean }) {
  const slot = await prisma.blueprintSlot.findUnique({
    where: { id: params.blueprintSlotId },
    include: {
      finalizedAttempt: true,
      practiceSet: true,
      questionRevision: { include: { answerChoices: true } },
      question: true,
    },
  });
  if (!slot || slot.practiceSet.studentId !== params.studentId) {
    throw new AdaptiveError("SLOT_NOT_FOUND", "Blueprint slot not found for this student.");
  }
  if (slot.finalizedAttempt) return slot.finalizedAttempt;

  const isCorrect = params.isBlank ? false : isAnswerCorrect(slot.question.questionType, params.answer ?? "", slot.questionRevision);

  try {
    return await prisma.$transaction(async (tx) => {
      const categoryState = await tx.categoryState.findUnique({
        where: { studentId_category: { studentId: params.studentId, category: slot.resolvedCategory } },
      });
      if (!categoryState) {
        throw new AdaptiveError("GENERATION_FAILED", "Category state missing for finalized answer.");
      }

      const update = computeAbilityUpdate({
        abilityBefore: categoryState.ability,
        difficulty: slot.resolvedDifficulty,
        isCorrect,
        previousAdaptiveAnswersInCategory: categoryState.adaptiveQuestionsAnswered,
      });

      const finalizedAttempt = await tx.finalizedAttempt.create({
        data: {
          studentId: params.studentId,
          practiceSetId: slot.practiceSetId,
          blueprintSlotId: slot.id,
          questionId: slot.questionId,
          category: slot.resolvedCategory,
          difficulty: slot.resolvedDifficulty,
          answer: params.isBlank ? null : params.answer,
          isBlank: params.isBlank,
          isCorrect,
          expectedProbability: update.expectedProbability,
          kValue: update.kValue,
          abilityBefore: categoryState.ability,
          rawAbilityChange: update.rawAbilityChange,
          appliedAbilityChange: update.appliedAbilityChange,
          abilityAfter: update.abilityAfter,
          engineVersion: ENGINE_VERSION,
        },
      });

      await tx.categoryState.update({
        where: { id: categoryState.id },
        data: {
          ability: update.abilityAfter,
          adaptiveQuestionsAnswered: { increment: 1 },
          lastAbilityUpdatedAt: new Date(),
        },
      });

      await tx.blueprintSlot.update({
        where: { id: slot.id },
        data: { draftAnswer: params.isBlank ? null : params.answer, skipped: params.isBlank },
      });

      return finalizedAttempt;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.finalizedAttempt.findUnique({ where: { blueprintSlotId: slot.id } });
      if (existing) return existing;
    }
    throw err;
  }
}
