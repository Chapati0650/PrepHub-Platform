import type { QuestionCategory } from "@/generated/prisma/client";
import { CATEGORY_LABELS } from "@/lib/content/labels";

// PRD-008 §7 "Your Journey" — pure narrative generation, kept separate from
// the data-fetching so the copy logic can be unit tested without a database.
export function buildJourneyNarrative(input: {
  startingRange: { min: number; max: number };
  completedSessions: number;
  totalQuestionsAnswered: number;
  totalImprovement: number;
  greatestImprovement: { category: QuestionCategory; deltaPoints: number } | null;
  targetScore: number | null;
  currentRangeMax: number;
}): string {
  const sentences: string[] = [];

  sentences.push(`You started PrepHub with a predicted SAT score of ${input.startingRange.min}–${input.startingRange.max}.`);

  if (input.completedSessions > 0) {
    const improvementClause =
      input.totalImprovement !== 0
        ? ` and ${input.totalImprovement > 0 ? "improved" : "changed"} your predicted SAT score by ${Math.abs(input.totalImprovement)} points`
        : "";
    sentences.push(
      `Since then, you've completed ${input.completedSessions} adaptive session${input.completedSessions === 1 ? "" : "s"}, answered ${input.totalQuestionsAnswered} questions${improvementClause}.`,
    );
  }

  if (input.greatestImprovement && input.greatestImprovement.deltaPoints > 0) {
    sentences.push(
      `Your greatest improvement has been ${CATEGORY_LABELS[input.greatestImprovement.category]}, increasing by ${input.greatestImprovement.deltaPoints}%.`,
    );
  }

  if (input.targetScore !== null) {
    const remaining = input.targetScore - input.currentRangeMax;
    sentences.push(
      remaining <= 0
        ? `You've reached your target score of ${input.targetScore}.`
        : `You're now within approximately ${remaining} points of your target score of ${input.targetScore}.`,
    );
  }

  return sentences.join(" ");
}
