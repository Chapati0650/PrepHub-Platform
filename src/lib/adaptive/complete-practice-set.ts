import type { QuestionCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL_CATEGORIES } from "./config";
import { AdaptiveError } from "./errors";
import { abilitiesFromHistory } from "./diagnostic-initialization";
import { diagnosticAnswers } from "./estimate";
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
    // The status flip is the claim. Two requests completing the same set (a
    // double-clicked Finish, two tabs) can both have read ACTIVE above, and a
    // re-read inside the transaction doesn't stop that under READ COMMITTED.
    // A conditional UPDATE does: the second waits on the first's row lock,
    // then re-checks `status` against the committed row, matches nothing, and
    // skips the counters — which would otherwise be incremented twice.
    const claimed = await tx.practiceSet.updateMany({
      where: { id: practiceSetId, status: "ACTIVE" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    if (claimed.count === 1) {
      // Every category is re-estimated from the whole history (estimate.ts):
      // per-answer updates are only a running approximation, and this is the
      // estimate the prediction and the next set are built from. The initial
      // ability is re-derived the same way from the Diagnostic alone, so
      // "since your Diagnostic" always compares two numbers from one engine —
      // including for a student whose Diagnostic was scored under an older one.
      const [diagnosticAttempts, practiceAnswers] = await Promise.all([
        tx.diagnosticAttempt.findMany({
          where: { diagnosticSession: { studentId } },
          select: { category: true, difficulty: true, isCorrect: true, submittedAt: true, waivedAt: true },
        }),
        tx.finalizedAttempt.findMany({
          where: { studentId },
          select: { category: true, difficulty: true, isCorrect: true },
        }),
      ]);
      // Both start where the Diagnostic put the student, which is the top of
      // the scale for a section they answered perfectly (diagnostic-initialization.ts).
      const fromDiagnostic = diagnosticAnswers(diagnosticAttempts);
      const initial = abilitiesFromHistory(fromDiagnostic);
      const current = abilitiesFromHistory(fromDiagnostic, practiceAnswers);

      for (const category of ALL_CATEGORIES) {
        const count = countsByCategory.get(category) ?? 0;
        await tx.categoryState.update({
          where: { studentId_category: { studentId, category } },
          data: {
            ability: current[category],
            initialAbility: initial[category],
            lastAbilityUpdatedAt: new Date(),
            ...(count === 1
              ? { consecutiveSetsWithoutExtraAllocation: { increment: 1 } }
              : { consecutiveSetsWithoutExtraAllocation: 0 }),
          },
        });
      }
    }

    return tx.practiceSet.findUniqueOrThrow({ where: { id: practiceSetId } });
  });
}
