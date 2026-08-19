import { z } from "zod";
import type { QuestionCategory } from "@/generated/prisma/client";
import { logCategoryClassificationFailure } from "@/lib/logger";
import { DEEPSEEK_MODELS, completeWithJson, getDeepSeekClient } from "@/lib/ai/deepseek-client";
import { extractApiErrorMessage } from "@/lib/ai/api-error-message";
import { CATEGORY_ORDER } from "./constants";
import { CATEGORY_LABELS } from "./labels";
import { ContentError } from "./errors";

export type ClassifyCategoryInput = {
  questionText: string;
  answerChoices: string[] | null; // in display order, MULTIPLE_CHOICE only
};

// Bulk-upload's per-question category step. Unlike difficulty (see
// classify-difficulty.ts — genuinely subjective, calibrated against student
// performance data no model can see, so it's always surfaced for Owner
// review rather than trusted outright), which of the 7 fixed skill
// categories a question belongs to is almost always unambiguous from its
// subject matter alone, so this runs automatically without a mandatory
// review gate. Still fully correctable afterward from the question editor's
// Category field if this reasoning is ever wrong.
const CategorySchema = z.object({
  category: z.enum([
    "READING_COMPREHENSION",
    "GRAMMAR",
    "VOCABULARY",
    "ALGEBRA",
    "GEOMETRY_TRIGONOMETRY",
    "ADVANCED_MATH",
    "PROBLEM_SOLVING_DATA_ANALYSIS",
  ]),
});

function getClient() {
  try {
    return getDeepSeekClient();
  } catch {
    throw new ContentError("CATEGORY_CLASSIFICATION_FAILED", "Category classification isn't configured for this environment.");
  }
}

export async function classifyQuestionCategory(input: ClassifyCategoryInput): Promise<QuestionCategory> {
  const client = getClient();

  const choicesBlock = input.answerChoices
    ? `\n\nAnswer choices:\n${input.answerChoices.map((c, i) => `${String.fromCharCode(65 + i)}) ${c}`).join("\n")}`
    : "";

  const categoryList = CATEGORY_ORDER.map((c) => `- ${c}: ${CATEGORY_LABELS[c]}`).join("\n");

  const prompt = `Classify this SAT-prep question into exactly one of these 7 fixed categories:
${categoryList}

Question: ${input.questionText}${choicesBlock}

Rules:
- Pick the single best-fitting category based on the subject matter being tested, not incidental wording.
- Math questions: Algebra covers linear/quadratic equations and systems; Geometry & Trig covers shapes, angles, area/volume, and trigonometric ratios; Advanced Math covers polynomials, exponentials, and nonlinear functions; Problem Solving & Data Analysis covers ratios, percentages, statistics, and data interpretation.
- Reading/Writing questions: Reading Comprehension covers passage-based questions about meaning, evidence, or structure; Grammar covers sentence structure, punctuation, and usage; Vocabulary covers word choice/meaning in context.

Respond with ONLY a json object, no other text, in exactly this shape:
{"category": "<one of the exact category values listed above>"}`;

  try {
    const result = await completeWithJson(client, { model: DEEPSEEK_MODELS.categoryClassification, prompt, schema: CategorySchema });
    return result.category;
  } catch (err) {
    logCategoryClassificationFailure("DeepSeek API call failed during category classification", {
      error: err instanceof Error ? err.message : String(err),
    });
    const detail = extractApiErrorMessage(err);
    throw new ContentError(
      "CATEGORY_CLASSIFICATION_FAILED",
      detail ? `Category classification failed: ${detail}` : "Category classification failed for this question.",
    );
  }
}
