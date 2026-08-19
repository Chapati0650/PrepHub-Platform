import { z } from "zod";
import type { QuestionCategory, QuestionDifficulty, QuestionType } from "@/generated/prisma/client";
import { logDifficultyClassificationFailure } from "@/lib/logger";
import { DEEPSEEK_MODELS, completeWithJson, getDeepSeekClient } from "@/lib/ai/deepseek-client";
import { extractApiErrorMessage } from "@/lib/ai/api-error-message";
import { ContentError } from "./errors";

export type ClassifyDifficultyInput = {
  questionText: string;
  category: QuestionCategory;
  questionType: QuestionType;
  answerChoices: string[] | null; // in display order, MULTIPLE_CHOICE only
};

export type ClassifyDifficultyResult = {
  difficulty: QuestionDifficulty;
  // Shown to the Owner during review (see bulk-upload.ts's aiAnswerReasoning)
  // — unlike category, difficulty isn't usually self-evident from a glance,
  // so a short explanation of what drove the estimate is worth the extra
  // output tokens.
  reasoning: string;
};

// Real SAT difficulty is calibrated against actual student performance data
// (what fraction of test-takers got it right) — this model has no access to
// that, so it can only ever approximate difficulty from how complex the
// question *looks*: solution steps, concept depth, reading burden. For real
// official SAT PDFs, the test's own module structure (e.g. digital SAT Math
// Module 2 running easy-to-hard by question position) is a strictly better,
// authoritative signal — see the Questions table's "Set Difficulty" bulk
// action for applying that. This is a fallback for everything else: a
// smarter starting point than a flat default, always still reviewable/
// correctable from the question editor.
const DifficultySchema = z.object({
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
  reasoning: z.string(),
});

function getClient() {
  try {
    return getDeepSeekClient();
  } catch {
    throw new ContentError("DIFFICULTY_CLASSIFICATION_FAILED", "Difficulty classification isn't configured for this environment.");
  }
}

export async function classifyQuestionDifficulty(input: ClassifyDifficultyInput): Promise<ClassifyDifficultyResult> {
  const client = getClient();

  const choicesBlock = input.answerChoices
    ? `\n\nAnswer choices:\n${input.answerChoices.map((c, i) => `${String.fromCharCode(65 + i)}) ${c}`).join("\n")}`
    : "";

  const prompt = `Estimate the difficulty of this SAT-prep question (category: ${input.category}) as it would appear on the actual SAT.

Question: ${input.questionText}${choicesBlock}

Rules:
- Judge difficulty the way the SAT itself calibrates it: how many solution steps or how much conceptual depth is required, how easily a well-prepared student could be misled, how dense/technical the reading is — not just surface length.
- EASY: solvable in one or two straightforward steps, tests a single concept directly.
- MEDIUM: requires combining a couple of concepts or a few solution steps, some room for a careless mistake.
- HARD: requires multi-step reasoning, an unusual approach, or deep/precise understanding of a nuanced concept.
- In reasoning, briefly explain what specifically makes it that difficulty (e.g. "single-step substitution" vs. "requires recognizing a hidden quadratic identity before solving") — this is shown only to the human reviewer, so terse working is fine.

Respond with ONLY a json object, no other text, in exactly this shape:
{"difficulty": "EASY" | "MEDIUM" | "HARD", "reasoning": "<string>"}`;

  try {
    return await completeWithJson(client, { model: DEEPSEEK_MODELS.difficultyClassification, prompt, schema: DifficultySchema });
  } catch (err) {
    logDifficultyClassificationFailure("DeepSeek API call failed during difficulty classification", {
      error: err instanceof Error ? err.message : String(err),
    });
    const detail = extractApiErrorMessage(err);
    throw new ContentError(
      "DIFFICULTY_CLASSIFICATION_FAILED",
      detail ? `Difficulty classification failed: ${detail}` : "Difficulty classification failed for this question.",
    );
  }
}
