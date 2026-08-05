import type { QuestionDifficulty } from "@/generated/prisma/client";
import { DIFFICULTY_RATING, MAX_ABILITY, MAX_ABILITY_CHANGE_PER_ANSWER, MIN_ABILITY, clamp, kValueFor } from "./config";

// PRD-014 §6.2 — probability the student was expected to answer correctly,
// given the question's fixed difficulty rating and the category's ability
// immediately before this answer.
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

// PRD-014 §6.4 / §16 pseudocode — the full Elo-style update for one finalized
// answer. Pure and side-effect-free so it can be unit tested exhaustively;
// the caller (finalize-answer.ts) is responsible for persisting atomically.
export function computeAbilityUpdate(input: {
  abilityBefore: number;
  difficulty: QuestionDifficulty;
  isCorrect: boolean;
  previousAdaptiveAnswersInCategory: number;
}): AbilityUpdateResult {
  const questionRating = DIFFICULTY_RATING[input.difficulty];
  const expected = expectedProbability(questionRating, input.abilityBefore);
  const result = input.isCorrect ? 1 : 0;
  const k = kValueFor(input.previousAdaptiveAnswersInCategory);

  const rawAbilityChange = k * (result - expected);
  const appliedAbilityChange = clamp(rawAbilityChange, -MAX_ABILITY_CHANGE_PER_ANSWER, MAX_ABILITY_CHANGE_PER_ANSWER);
  const abilityAfter = clamp(input.abilityBefore + appliedAbilityChange, MIN_ABILITY, MAX_ABILITY);

  return { expectedProbability: expected, kValue: k, rawAbilityChange, appliedAbilityChange, abilityAfter };
}
