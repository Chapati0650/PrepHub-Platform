import type { QuestionCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL_CATEGORIES } from "./config";
import { AdaptiveError } from "./errors";
import { finalizeAnswer } from "./finalize-answer";

// PRD-014 §13 "Set submission with blanks" / "Completion". Blank confirmation
// (finalizing every remaining unanswered slot as incorrect) reuses the same
// atomic/idempotent finalizeAnswer path as a normal submission, so each blank
// gets exactly one Ability Score update even under a retried request.
export async function completePracticeSet(studentId: string, practiceSetId: string, options: { confirmBlanks: boolean }) {
  const set = await prisma.practiceSet.findUnique({
    where: { id: practiceSetId },
    include: { slots: { include: { finalizedAttempt: true } } },
  });
  if (!set || set.studentId !== studentId) {
    throw new AdaptiveError("SET_NOT_FOUND", "Practice set not found for this student.");
  }
  if (set.status === "COMPLETED") return set;

  const unfinalized = set.slots.filter((s) => !s.finalizedAttempt);
  if (unfinalized.length > 0 && !options.confirmBlanks) {
    throw new AdaptiveError("BLANKS_REMAIN", `${unfinalized.length} question(s) remain unanswered.`);
  }

  for (const slot of unfinalized) {
    await finalizeAnswer({ studentId, blueprintSlotId: slot.id, answer: null, isBlank: true });
  }

  const countsByCategory = new Map<QuestionCategory, number>();
  for (const slot of set.slots) {
    countsByCategory.set(slot.resolvedCategory, (countsByCategory.get(slot.resolvedCategory) ?? 0) + 1);
  }

  return prisma.$transaction(async (tx) => {
    const fresh = await tx.practiceSet.findUnique({ where: { id: practiceSetId } });
    if (fresh?.status === "COMPLETED") return fresh;

    for (const category of ALL_CATEGORIES) {
      const count = countsByCategory.get(category) ?? 0;
      await tx.categoryState.update({
        where: { studentId_category: { studentId, category } },
        data:
          count === 1
            ? { consecutiveSetsWithoutExtraAllocation: { increment: 1 } }
            : { consecutiveSetsWithoutExtraAllocation: 0 },
      });
    }

    return tx.practiceSet.update({
      where: { id: practiceSetId },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  });
}
