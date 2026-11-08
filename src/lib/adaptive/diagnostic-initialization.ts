import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { abilityForSectionScore } from "@/lib/score/config";
import { ABILITY_MODEL, CATEGORY_SECTION, type ScoreSection } from "./config";
import { diagnosticAnswers, estimateAbilities, type ScoredAnswer } from "./estimate";

type DiagnosticAttemptRow = {
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  isCorrect: boolean | null;
  submittedAt: Date | null;
  waivedAt: Date | null;
};

/**
 * Where a student starts when the Diagnostic couldn't find their limit.
 *
 * The Diagnostic's hardest questions are College Board "Hard", centred near
 * 660 a section, so a section answered perfectly shows a student is above
 * that and can't show how far. Estimated against the whole population, such a
 * student lands near 1300, which is the model extrapolating into a range it
 * has no data for: on 2026-11-06 nobody had scored perfectly and none of the
 * near-perfect students had practised. The Owner's decision is that a perfect
 * Diagnostic predicts the top range. So a section with every Medium right
 * (every Hard question earned) and no misses starts at the top of the scale
 * instead of at the population mean; with one miss it starts
 * halfway, so one miss costs about one range rather than falling off a cliff.
 * Anything else starts at the population mean, as for everyone else. On the
 * 75 real Diagnostics this moves 18 students, all of them near-perfect in a
 * section, and leaves the median where it was.
 *
 * It's a starting point, not a verdict: every later estimate carries it
 * (completePracticeSet), so a student who keeps answering hard questions
 * right stays at the top, and one who doesn't comes down with the evidence.
 */
export const DIAGNOSTIC_CEILING = {
  /** The top displayed range's midpoint, per section (1530-1600). */
  sectionScore: 782.5,
  /** Misses in a section that take its start all the way back to typical. */
  missesToTypical: 2,
} as const;

export function diagnosticStartingPoint(answers: readonly ScoredAnswer[]): Partial<Record<ScoreSection, number>> {
  const start: Partial<Record<ScoreSection, number>> = {};
  for (const section of ["READING_WRITING", "MATH"] as const) {
    const served = answers.filter((a) => CATEGORY_SECTION[a.category] === section);
    // Only a student who earned every Hard question the section had has
    // reached its ceiling: a missed Medium means its Hard was never served. A
    // Hard question the bank had none of (start-diagnostic.ts) doesn't count
    // against them, as long as they met at least one.
    const missedMedium = served.some((a) => a.difficulty === "MEDIUM" && !a.isCorrect);
    if (missedMedium || !served.some((a) => a.difficulty === "HARD")) continue;
    const misses = served.filter((a) => !a.isCorrect).length;
    const weight = Math.max(0, 1 - misses / DIAGNOSTIC_CEILING.missesToTypical);
    if (weight === 0) continue;
    const top = abilityForSectionScore(section, DIAGNOSTIC_CEILING.sectionScore);
    start[section] = ABILITY_MODEL.populationMean + weight * (top - ABILITY_MODEL.populationMean);
  }
  return start;
}

/** Every category's ability from a student's whole history, starting where their Diagnostic puts them. */
export function abilitiesFromHistory(
  diagnostic: readonly ScoredAnswer[],
  practice: readonly ScoredAnswer[] = [],
): Record<QuestionCategory, number> {
  return estimateAbilities([...diagnostic, ...practice], { sectionPriorMean: diagnosticStartingPoint(diagnostic) });
}

// PRD-014 §5 — the Diagnostic's answers set every category's initial Ability
// Score. Since engine 2026.2 this is the same estimate every Practice Set
// uses (estimate.ts), not PRD-014's pattern table, and the Diagnostic's
// prediction is read from exactly these abilities: with one scale, finishing
// a set with nothing learned can no longer move the prediction.
export function initialAbilitiesFromDiagnostic(attempts: readonly DiagnosticAttemptRow[]): Record<QuestionCategory, number> {
  return abilitiesFromHistory(diagnosticAnswers(attempts));
}
