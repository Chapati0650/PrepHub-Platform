import type { QuestionCategory } from "@/generated/prisma/client";
import type { ScoredAnswer } from "@/lib/adaptive/estimate";
import { predictScore, type ScorePrediction } from "./predict";

export type AdaptivePredictionResult = ScorePrediction & { approximateImprovement: number };

// PRD-016 §13.2 — pure computation half of a post-set prediction. Takes the
// student's seven current Ability Scores, every answer they were estimated
// from (for the band), and the point the Diagnostic scores under this same
// engine (the improvement baseline, §7).
export function computeAdaptivePrediction(
  abilities: Record<QuestionCategory, number>,
  answers: readonly ScoredAnswer[],
  initialDiagnosticPoint: number,
): AdaptivePredictionResult {
  const prediction = predictScore(abilities, answers);
  return { ...prediction, approximateImprovement: prediction.point - initialDiagnosticPoint };
}
