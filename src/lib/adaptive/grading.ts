import type { QuestionAnswerChoice, QuestionType } from "@/generated/prisma/client";

// Mirrors the grading logic already established in the Owner's Student Preview
// (src/app/(app)/owner/content/questions/student-preview-sheet.tsx) so a
// question grades identically in preview and in real student practice.
export function isAnswerCorrect(
  questionType: QuestionType,
  answer: string,
  context: { answerChoices: Pick<QuestionAnswerChoice, "id" | "isCorrect">[]; acceptedAnswers: string[] },
): boolean {
  if (questionType === "MULTIPLE_CHOICE") {
    return context.answerChoices.some((c) => c.id === answer && c.isCorrect);
  }
  const normalized = answer.trim().toLowerCase();
  return context.acceptedAnswers.some((a) => a.trim().toLowerCase() === normalized);
}
