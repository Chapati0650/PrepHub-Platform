import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { MAX_ABILITY, MAX_ABILITY_CHANGE_PER_ANSWER, MIN_ABILITY, clamp, kValueFor, questionRating } from "./config";

// PRD-014 §6.2 — probability the student was expected to answer correctly,
// given the question's rating and the category's ability immediately before
// this answer.
export function expectedProbability(questionRating: number, abilityBefore: number): number {
  return 1 / (1 + 10 ** ((questionRating - abilityBefore) / 40));
}

export type AbilityUpdateResult = {
  expectedProbability: number;
  kValue: number;
  rawAbilityChange: number;
  appliedAbilityChange: number;
  abilityAfter: number;
};

// PRD-014 §6.4 / §16 pseudocode — the Elo-style update for one finalized
// answer: the running estimate between completions (each completed set
// recomputes every category from the whole history in estimate.ts). Pure and
// side-effect-free so it can be unit tested exhaustively; the caller
// (finalize-answer.ts) is responsible for persisting atomically.
export function computeAbilityUpdate(input: {
  abilityBefore: number;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  isCorrect: boolean;
  previousAdaptiveAnswersInCategory: number;
}): AbilityUpdateResult {
  const expected = expectedProbability(questionRating(input.category, input.difficulty), input.abilityBefore);
  const result = input.isCorrect ? 1 : 0;
  const k = kValueFor(input.previousAdaptiveAnswersInCategory);

  const rawAbilityChange = k * (result - expected);
  const appliedAbilityChange = clamp(rawAbilityChange, -MAX_ABILITY_CHANGE_PER_ANSWER, MAX_ABILITY_CHANGE_PER_ANSWER);
  const abilityAfter = clamp(input.abilityBefore + appliedAbilityChange, MIN_ABILITY, MAX_ABILITY);

  return { expectedProbability: expected, kValue: k, rawAbilityChange, appliedAbilityChange, abilityAfter };
}
