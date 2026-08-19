import { createHash } from "node:crypto";
import type { QuestionType } from "@/generated/prisma/client";
import { logAnswerDetectionFailure, logDifficultyClassificationFailure, logExplanationGenerationFailure } from "@/lib/logger";
import { createQuestion, findQuestionIdByExactText, findQuestionIdsByImageHash, updateDraftContent } from "./questions";
import { transcribeQuestionImage, transcribeQuestionPage, type QuestionTranscription } from "./transcribe";
import { determineCorrectAnswer } from "./determine-answer";
import { classifyQuestionCategory } from "./classify-category";
import { classifyQuestionDifficulty } from "./classify-difficulty";
import { generateExplanationText, generateDistractorExplanations } from "./generate-explanation";
import { DEFAULT_BULK_UPLOAD_DIFFICULTY, MULTIPLE_CHOICE_OPTION_COUNT } from "./constants";

export type BulkUploadImageInput = {
  buffer: Buffer;
  mimeType: string;
};

export type BulkUploadImageResult = { questionId: string; skipped?: boolean } | { error: string };

// Duplicate detection, checked before any AI call runs — not after. Added
// following a real incident: a (since-fixed) false "Failed" status led to
// the same PDF pages being re-uploaded repeatedly, producing 125 duplicate
// questions across 41 groups and burning real transcription/generation
// tokens on content that had already been fully processed. Hashing the
// exact source bytes (rather than, say, the transcribed text) means the
// check costs nothing and needs no AI call itself — re-selecting the same
// file is instantly recognized. It deliberately will not catch a
// *different* file of visually-similar content (a re-scanned or
// re-exported PDF) — that's a much harder problem this doesn't attempt to
// solve; it solves the actual observed cause, re-submitting the identical
// file.
function hashImageBytes(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// Multiple-choice vs. open-ended is detected per question, not chosen once
// for the whole batch: an open-ended question has no answer choices, a
// multiple-choice one always has exactly MULTIPLE_CHOICE_OPTION_COUNT, and
// transcription already surfaces that as answerChoices being null vs. an
// array — so the transcribed content itself already carries the signal.
// Category is detected per question too (see classifyQuestionCategory
// below), so a batch can freely mix categories as well as question types.
function detectQuestionType(answerChoices: string[] | null): { questionType: QuestionType } | { error: string } {
  if (answerChoices === null) return { questionType: "OPEN_ENDED_NUMERIC" };
  if (answerChoices.length === MULTIPLE_CHOICE_OPTION_COUNT) return { questionType: "MULTIPLE_CHOICE" };
  return {
    error: `Expected either an open-ended question with no answer choices, or a multiple-choice question with ${MULTIPLE_CHOICE_OPTION_COUNT} answer choices, but found ${answerChoices.length}. Create this question manually instead.`,
  };
}

// Takes one already-transcribed question through the rest of the pipeline:
// detect its type, classify its category (see classify-category.ts —
// trusted without a mandatory review gate, unlike the correct answer below),
// estimate its difficulty (see classify-difficulty.ts — a best-effort
// starting point, not trusted outright; falls back to
// DEFAULT_BULK_UPLOAD_DIFFICULTY on failure and is always still surfaced for
// Owner review, same as the correct answer), create it, determine the
// correct answer (see determine-answer.ts), then write an explanation for
// that answer. Shared by both processBulkUploadImage (one question per
// image) and processBulkUploadPdfPage (zero-to-many questions per PDF page)
// below, so the actual content-generation pipeline can't drift between the
// two entry points.
//
// Deliberately never throws: each question is independent, so one bad one
// (a refused generation, a network blip) must not abort the rest of a batch
// or a multi-question page.
//
// Deliberately does NOT generate step diagrams — that stays the expensive,
// manual, opt-in action from the explanation-generation cost redesign
// (generateStepDiagram/generateExplanationAction's diagram button). Running
// it automatically for every bulk-uploaded question would reintroduce the
// exact per-question cost problem that redesign fixed.
async function processTranscribedQuestion(
  transcription: QuestionTranscription,
  sourceImageHash: string,
): Promise<BulkUploadImageResult> {
  try {
    const detected = detectQuestionType(transcription.answerChoices);
    if ("error" in detected) return detected;
    const { questionType } = detected;

    // Second-layer duplicate check (see findQuestionIdByExactText) — catches
    // the same question re-submitted via a *different* source file (e.g. an
    // Owner extracting "the pages that failed" into a new PDF), which
    // sourceImageHash can't, since a different file's rendered bytes won't
    // reliably match even for visually-identical content. Runs after the one
    // transcription call this question already needed, but before every
    // more expensive downstream call — the transcription cost is sunk
    // either way, so this only saves category classification, answer
    // detection, explanation generation, and distractor generation, not
    // this one AI call. Still much cheaper than the alternative: a full
    // duplicate question.
    const existingByText = await findQuestionIdByExactText(transcription.questionText);
    if (existingByText) {
      return { questionId: existingByText, skipped: true };
    }

    const category = await classifyQuestionCategory({
      questionText: transcription.questionText,
      answerChoices: transcription.answerChoices,
    });

    // Best-effort — a smarter starting point than always defaulting to
    // DEFAULT_BULK_UPLOAD_DIFFICULTY, but never worth failing an otherwise-
    // good question over (same "optional side effect never blocks the core
    // operation" pattern as distractor generation below). Falls back to the
    // old flat default on any failure.
    let difficulty = DEFAULT_BULK_UPLOAD_DIFFICULTY;
    let difficultyReasoning: string | null = null;
    try {
      const difficultyResult = await classifyQuestionDifficulty({
        questionText: transcription.questionText,
        category,
        questionType,
        answerChoices: transcription.answerChoices,
      });
      difficulty = difficultyResult.difficulty;
      difficultyReasoning = difficultyResult.reasoning;
    } catch (err) {
      logDifficultyClassificationFailure("Difficulty classification failed during bulk upload — defaulted to Medium", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    let questionId: string;
    try {
      const question = await createQuestion({ questionType, category, difficulty, sourceImageHash });
      questionId = question.id;
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Couldn't create the question." };
    }

    const answer = await determineCorrectAnswer({
      questionText: transcription.questionText,
      category,
      questionType,
      answerChoices: transcription.answerChoices,
    });

    if (questionType === "MULTIPLE_CHOICE" && answer.correctChoiceIndex === null) {
      logAnswerDetectionFailure("Answer detection returned no choice index for a multiple-choice question", { affectedResourceId: questionId });
      return { error: "Couldn't determine a correct answer for this question. Create it manually instead." };
    }
    if (questionType === "OPEN_ENDED_NUMERIC" && answer.acceptedAnswers.length === 0) {
      logAnswerDetectionFailure("Answer detection returned no accepted answers for a numeric question", { affectedResourceId: questionId });
      return { error: "Couldn't determine a correct answer for this question. Create it manually instead." };
    }

    await updateDraftContent(questionId, {
      questionText: transcription.questionText,
      questionImageId: transcription.questionImageId,
      ...(questionType === "MULTIPLE_CHOICE"
        ? {
            answerChoices: transcription.answerChoices!.map((text, i) => ({
              text,
              imageId: null,
              isCorrect: i === answer.correctChoiceIndex,
            })),
          }
        : { acceptedAnswers: answer.acceptedAnswers }),
      aiGenerated: true,
      aiAnswerReasoning: [
        `Confidence: ${answer.confidence}. ${answer.reasoning}`,
        difficultyReasoning ? `Difficulty (${difficulty}): ${difficultyReasoning}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    });

    const steps = await generateExplanationText({
      questionText: transcription.questionText,
      category,
      questionType,
      answerChoices: transcription.answerChoices,
      correctChoiceIndex: answer.correctChoiceIndex,
      acceptedAnswers: answer.acceptedAnswers,
    });

    await updateDraftContent(questionId, {
      explanationSteps: steps.map((s) => ({ text: s.text, imageId: null })),
    });

    // Best-effort, MULTIPLE_CHOICE only — the question is already fully
    // usable without these notes (same "optional side effects never block
    // the core operation" pattern as everywhere else in this pipeline), so a
    // failure here doesn't fail the whole question; the Owner can generate
    // or write them by hand from the question editor during review.
    if (questionType === "MULTIPLE_CHOICE") {
      try {
        const distractors = await generateDistractorExplanations({
          questionText: transcription.questionText,
          category,
          answerChoices: transcription.answerChoices!,
          correctChoiceIndex: answer.correctChoiceIndex!,
          correctExplanationSteps: steps.map((s) => s.text),
        });
        const byIndex = new Map(distractors.map((d) => [d.choiceIndex, d.explanation]));
        await updateDraftContent(questionId, {
          answerChoices: transcription.answerChoices!.map((text, i) => ({
            text,
            imageId: null,
            isCorrect: i === answer.correctChoiceIndex,
            distractorExplanation: byIndex.get(i) ?? null,
          })),
        });
      } catch (err) {
        logExplanationGenerationFailure("Distractor explanation generation failed during bulk upload", {
          affectedResourceId: questionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { questionId };
  } catch (err) {
    // If a question row was already created before this point, it stays
    // around as an empty/partial draft — surfacing questionId here would be
    // misleading since it has no usable content, so this reports the
    // failure only. The orphaned draft is harmless clutter the Owner can
    // delete like any other never-published draft (deleteQuestionPermanently
    // already allows this).
    return { error: err instanceof Error ? err.message : "Something went wrong processing this question." };
  }
}

// One question image in, one question out — the original bulk-upload entry
// point (a plain photo/screenshot, a zip of them, or Google Drive images;
// see bulk-upload-form.tsx). The caller (bulkUploadImageAction) is invoked
// once per image from the client, in a small concurrency pool.
export async function processBulkUploadImage(input: BulkUploadImageInput): Promise<BulkUploadImageResult> {
  const sourceImageHash = hashImageBytes(input.buffer);
  const existing = await findQuestionIdsByImageHash(sourceImageHash);
  if (existing.length > 0) {
    return { questionId: existing[0], skipped: true };
  }

  let transcription: QuestionTranscription;
  try {
    transcription = await transcribeQuestionImage({ buffer: input.buffer, mimeType: input.mimeType });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Something went wrong processing this image." };
  }
  return processTranscribedQuestion(transcription, sourceImageHash);
}

export type BulkUploadPdfPageResult = { questionIds: string[]; errors: string[]; skipped?: boolean };

// One rendered PDF page in, zero-to-many questions out — the entry point for
// a full practice-test PDF (see extract-pdf-pages.ts, which renders each
// page to an image client-side before this ever runs). Unlike
// processBulkUploadImage, a single page can legitimately produce several
// questions (a densely-laid-out practice test) or none at all (a cover page,
// instructions, an answer key) — see transcribeQuestionPage's prompt for how
// question boundaries and page-spanning questions are handled. Each detected
// question runs through the identical processTranscribedQuestion pipeline,
// independently: one bad question on a page must not lose the others.
export async function processBulkUploadPdfPage(input: BulkUploadImageInput): Promise<BulkUploadPdfPageResult> {
  const sourceImageHash = hashImageBytes(input.buffer);
  const existing = await findQuestionIdsByImageHash(sourceImageHash);
  if (existing.length > 0) {
    return { questionIds: existing, errors: [], skipped: true };
  }

  let transcriptions: QuestionTranscription[];
  try {
    transcriptions = await transcribeQuestionPage({ buffer: input.buffer, mimeType: input.mimeType });
  } catch (err) {
    return { questionIds: [], errors: [err instanceof Error ? err.message : "Something went wrong processing this page."] };
  }

  // Run every question's pipeline concurrently, not one after another — each
  // is independent (its own create/answer/explain chain), so sequentially
  // awaiting them just stacked up their latencies for no reason. Confirmed
  // via real production logs: a single multi-question page took as long as
  // 7.6 minutes processed sequentially, comfortably exceeding the client's
  // timeout (bulk-upload-form.tsx) even though the server-side work was
  // genuinely still succeeding — the page just looked "stuck" from the
  // client's point of view. Parallelizing bounds a page's total time to
  // roughly its single slowest question instead of the sum of all of them.
  const results = await Promise.all(transcriptions.map((transcription) => processTranscribedQuestion(transcription, sourceImageHash)));

  const questionIds: string[] = [];
  const errors: string[] = [];
  for (const result of results) {
    if ("error" in result) errors.push(result.error);
    else questionIds.push(result.questionId);
  }
  return { questionIds, errors };
}
