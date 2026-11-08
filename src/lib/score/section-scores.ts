import type { PredictionSourceType } from "@/generated/prisma/client";
import { LEGACY_SCORING_VERSION, RANGE_SCORING_VERSION, SCORING_ENGINE_VERSION, rangeForAbility, sectionScoreFromAbility } from "./config";
import { roundToStep } from "./real-test";

export type StoredPrediction = {
  sourceType: PredictionSourceType;
  scoringEngineVersion: string;
  readingWritingAbility: number | null;
  mathAbility: number | null;
};

export type SectionScores = { readingWriting: number; math: number };

/**
 * A stored prediction's two section scores, read by the rules of the engine
 * that wrote it, so no entry is ever re-scored by a later one (PRD-016 §11).
 *
 * - 2026.3 entries hold section abilities on SECTION_SCORE_LINES, scored as the
 *   real SAT reports them (rounded to 10).
 * - 2026.2 entries hold the same abilities, read to the nearest point.
 * - 2026.1 Practice Set entries hold abilities on that engine's total-score
 *   table, read as half of the matching range's midpoint, as it always was.
 * - 2026.1 Diagnostic entries hold 400-1600 *pattern values* in the ability
 *   columns, so half of each is the section score. The old reader ran those
 *   through the ability table, where any value from 400 up is the top band,
 *   so every Diagnostic read as about 780 a section and every student looked
 *   college-ready on day one.
 *
 * Null when a value is missing or the version is one this code can't read.
 */
export function sectionScoresForEntry(entry: StoredPrediction): SectionScores | null {
  const { readingWritingAbility: rw, mathAbility: math } = entry;
  if (rw === null || math === null) return null;
  if (entry.scoringEngineVersion === SCORING_ENGINE_VERSION) {
    return {
      readingWriting: roundToStep(sectionScoreFromAbility("READING_WRITING", rw)),
      math: roundToStep(sectionScoreFromAbility("MATH", math)),
    };
  }
  if (entry.scoringEngineVersion === RANGE_SCORING_VERSION) {
    return {
      readingWriting: Math.round(sectionScoreFromAbility("READING_WRITING", rw)),
      math: Math.round(sectionScoreFromAbility("MATH", math)),
    };
  }
  if (entry.scoringEngineVersion === LEGACY_SCORING_VERSION) {
    if (entry.sourceType === "DIAGNOSTIC") return { readingWriting: Math.round(rw / 2), math: Math.round(math / 2) };
    return {
      readingWriting: Math.round(rangeForAbility(rw).midpoint / 2),
      math: Math.round(rangeForAbility(math).midpoint / 2),
    };
  }
  return null;
}
