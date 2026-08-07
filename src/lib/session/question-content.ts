import { prisma } from "@/lib/prisma";
import type { CalculatorSetting, QuestionType } from "@/generated/prisma/client";

// What a student sees BEFORE submitting — never includes which choice is
// correct or the accepted numeric answers, so the client can't cheat by
// reading the payload.
export type StudentQuestionContent = {
  questionRevisionId: string;
  questionType: QuestionType;
  questionText: string;
  questionImageId: string | null;
  calculatorSetting: CalculatorSetting;
  suggestedTimeSeconds: number;
  answerChoices: { id: string; text: string; imageId: string | null }[];
};

export async function getStudentQuestionContent(questionRevisionId: string): Promise<StudentQuestionContent> {
  const revision = await prisma.questionRevision.findUniqueOrThrow({
    where: { id: questionRevisionId },
    include: { question: true, answerChoices: { orderBy: { order: "asc" } } },
  });

  return {
    questionRevisionId: revision.id,
    questionType: revision.question.questionType,
    questionText: revision.questionText,
    questionImageId: revision.questionImageId,
    calculatorSetting: revision.calculatorSetting,
    suggestedTimeSeconds: revision.suggestedTimeSeconds,
    answerChoices: revision.answerChoices.map((c) => ({ id: c.id, text: c.text, imageId: c.imageId })),
  };
}

// Only safe to fetch AFTER the student's answer has been finalized.
export type StudentQuestionFeedback = {
  correctChoiceId: string | null;
  acceptedAnswers: string[];
  writtenExplanation: string | null;
  // Richer alternative to writtenExplanation (PRD-013-style step-by-step,
  // each step optionally carrying its own diagram/chart image) — the
  // renderer prefers this over writtenExplanation when non-empty.
  explanationSteps: { text: string; imageId: string | null }[];
  explanationVideoId: string | null;
};

export async function getStudentQuestionFeedback(questionRevisionId: string): Promise<StudentQuestionFeedback> {
  const revision = await prisma.questionRevision.findUniqueOrThrow({
    where: { id: questionRevisionId },
    include: {
      answerChoices: true,
      explanationSteps: { orderBy: { order: "asc" } },
      standaloneVideo: true,
      question: { include: { family: { include: { sharedVideo: true } } } },
    },
  });

  // PRD-013: family questions share one video; standalone questions carry
  // their own. A family's shared video always wins when both exist.
  const video = revision.question.family?.sharedVideo ?? revision.standaloneVideo;

  return {
    correctChoiceId: revision.answerChoices.find((c) => c.isCorrect)?.id ?? null,
    acceptedAnswers: revision.acceptedAnswers,
    writtenExplanation: revision.writtenExplanation,
    explanationSteps: revision.explanationSteps.map((s) => ({ text: s.text, imageId: s.imageId })),
    explanationVideoId: video?.status === "READY" ? video.id : null,
  };
}
