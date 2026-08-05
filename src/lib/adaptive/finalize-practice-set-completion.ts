import { completePracticeSet } from "./complete-practice-set";
import { generatePracticeSet } from "./generate-practice-set";
import { generateAdaptivePrediction } from "@/lib/score/generate-adaptive-prediction";
import { logGenerationFailure } from "@/lib/logger";

// PRD-005 §22/§23 — completion processing: finalize the set, update the
// prediction, then pre-generate the next set in the background so it's ready
// by the time the student exits Session Review. A failure to pre-generate
// must not block completion or the review screen (same defensive pattern as
// the diagnostic's finalizeDiagnosticCompletion) — it can be regenerated
// lazily the next time the student opens Practice.
export async function finalizePracticeSetCompletion(studentId: string, practiceSetId: string) {
  const set = await completePracticeSet(studentId, practiceSetId, { confirmBlanks: false });
  const prediction = await generateAdaptivePrediction(studentId, practiceSetId);

  try {
    await generatePracticeSet(studentId);
  } catch (err) {
    logGenerationFailure("Failed to pre-generate the next practice set after set completion", {
      accountId: studentId,
      affectedResourceId: practiceSetId,
      errorType: err instanceof Error ? err.message : String(err),
    });
  }

  return { set, prediction };
}
