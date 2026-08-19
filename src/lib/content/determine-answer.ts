import { z } from "zod";
import { logAnswerDetectionFailure } from "@/lib/logger";
import { DEEPSEEK_MODELS, completeWithJson, getDeepSeekClient } from "@/lib/ai/deepseek-client";
import { extractApiErrorMessage } from "@/lib/ai/api-error-message";
import { ContentError } from "./errors";

// The one genuinely new AI capability in the bulk-upload pipeline: unlike
// transcription (explicitly forbidden from determining the answer) and
// explanation generation (explicitly told the answer is already verified,
// never to re-derive it), this function actually solves the question. Its
// output is deliberately never trusted as final — the bulk-upload pipeline
// that calls this always marks the resulting revision `aiGenerated: true`
// with `aiReviewedAt: null`, which blocks publish (see validation.ts) until
// an Owner explicitly reviews it against `reasoning` below.
export type DetermineAnswerInput = {
  questionText: string;
  category: string;
  questionType: "MULTIPLE_CHOICE" | "OPEN_ENDED_NUMERIC";
  answerChoices: string[] | null; // in display order, MULTIPLE_CHOICE only
};

export type DetermineAnswerResult = {
  correctChoiceIndex: number | null; // MULTIPLE_CHOICE only
  acceptedAnswers: string[]; // OPEN_ENDED_NUMERIC only
  confidence: "high" | "medium" | "low";
  reasoning: string; // shown to the Owner during review, never to students
};

function choicesBlock(input: DetermineAnswerInput): string {
  return input.questionType === "MULTIPLE_CHOICE" && input.answerChoices
    ? `\n\nAnswer choices:\n${input.answerChoices.map((c, i) => `${String.fromCharCode(65 + i)}) ${c}`).join("\n")}`
    : "";
}

function getClient() {
  try {
    return getDeepSeekClient();
  } catch {
    throw new ContentError("ANSWER_DETECTION_FAILED", "Answer detection isn't configured for this environment.");
  }
}

// Flat schema with nullable fields, not a discriminated union — matches the
// established convention in transcribe.ts/generate-explanation.ts, whose
// structured-output schemas are always flat. The prompt below is told which
// branch to fill in based on input.questionType (already known, so it isn't
// asked to echo it back).
const AnswerSchema = z.object({
  correctChoiceIndex: z.number().int().min(0).nullable(),
  acceptedAnswers: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string(),
});

export async function determineCorrectAnswer(input: DetermineAnswerInput): Promise<DetermineAnswerResult> {
  const client = getClient();

  const answerInstructions =
    input.questionType === "MULTIPLE_CHOICE"
      ? "Work through the question carefully, then set correctChoiceIndex to the 0-based index of the correct choice (0 for A, 1 for B, 2 for C, 3 for D)."
      : 'Work through the question carefully, then set acceptedAnswers to every equivalent correct form of the numeric answer a student might reasonably enter (e.g. "0.5" and "1/2" for the same value). Provide at least one.';

  const prompt = `Solve this SAT-prep question (category: ${input.category}) to determine its correct answer.

Question: ${input.questionText}${choicesBlock(input)}

Rules:
- ${answerInstructions}
- Set confidence to "high" only if you're certain; "medium" if there's some ambiguity in the question or your reasoning; "low" if you're genuinely unsure. Be honest — a human will review every answer before it's published, so an accurate confidence rating (even "low") is more useful than an overconfident guess.
- In reasoning, briefly explain how you arrived at the answer — this is shown only to the human reviewer, not to students, so it can be terse working, not polished prose.

Respond with ONLY a json object, no other text, in exactly this shape:
{"correctChoiceIndex": <0-based index or null>, "acceptedAnswers": [<string>, ...], "confidence": "high" | "medium" | "low", "reasoning": "<string>"}
Example for a multiple-choice question: {"correctChoiceIndex": 2, "acceptedAnswers": [], "confidence": "high", "reasoning": "..."}
Example for an open-ended numeric question: {"correctChoiceIndex": null, "acceptedAnswers": ["0.5", "1/2"], "confidence": "high", "reasoning": "..."}`;

  try {
    return await completeWithJson(client, { model: DEEPSEEK_MODELS.answerDetection, prompt, schema: AnswerSchema });
  } catch (err) {
    logAnswerDetectionFailure("DeepSeek API call failed during answer detection", {
      error: err instanceof Error ? err.message : String(err),
    });
    const detail = extractApiErrorMessage(err);
    throw new ContentError("ANSWER_DETECTION_FAILED", detail ? `Answer detection failed: ${detail}` : "Answer detection failed for this question.");
  }
}
