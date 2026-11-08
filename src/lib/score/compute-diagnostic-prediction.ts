import type { QuestionCategory } from "@/generated/prisma/client";
import type { ScoredAnswer } from "@/lib/adaptive/estimate";
import { predictScore, type ScorePrediction } from "./predict";

export type DiagnosticPredictionResult = ScorePrediction;

// PRD-016 §13.1 — pure computation half of the diagnostic prediction, from
// the abilities the Diagnostic sets (adaptive/diagnostic-initialization.ts)
// and the answers they came from. The same function as a Practice Set's; only
// the baseline differs. Persistence is the caller's job in
// generate-diagnostic-prediction.ts.
export function computeDiagnosticPrediction(
  abilities: Record<QuestionCategory, number>,
  answers: readonly ScoredAnswer[],
): DiagnosticPredictionResult {
  return predictScore(abilities, answers);
}
