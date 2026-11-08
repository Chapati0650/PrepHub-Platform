// PRD-016 §11 "Configuration and Versioning" — every tunable value the
// Predicted SAT Score Engine uses lives here. Bumping SCORING_ENGINE_VERSION
// on any change to this file is how historical PredictionHistoryEntry rows
// stay honest about which rules produced them — configuration changes must
// never rewrite prediction history retroactively (§11, §14).
//
// 2026.2 (2026-11-06): the Diagnostic and Practice Sets are scored by one
// function (predict.ts) from one estimate (adaptive/estimate.ts), and ability
// becomes a score through SECTION_SCORE_ANCHORS below. Entries written under
// 2026.1 are read through LEGACY_2026_1 (sectionScoresForEntry), never
// re-scored.
//
// 2026.3 (2026-11-08): a prediction is one score with a likely band, the way
// the real SAT reports a score (real-test.ts), instead of one of fifteen
// ranges. The ability model, ratings, lines and weights are unchanged, so
// 2026.2 entries' abilities mean the same thing; what changed is what is
// stored in the display columns (see PredictionHistoryEntry usage in
// generate-*-prediction.ts) and the rounding. Entries written under 2026.2
// keep their ranges and are never paired with 2026.3 ones.
import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { ABILITY_LOGISTIC_SCALE, ALL_CATEGORIES, CATEGORY_SECTION, questionRating, type ScoreSection } from "@/lib/adaptive/config";

export const SCORING_ENGINE_VERSION = "2026.3";
/** The version that stored a range of fifteen bands, read by the same ability lines as 2026.3. */
export const RANGE_SCORING_VERSION = "2026.2";
export const LEGACY_SCORING_VERSION = "2026.1";

/** Versions whose entries hold a single score (representativeMidpoint) with a band (displayedRangeMinimum/Maximum). */
export const POINT_SCORING_VERSIONS: readonly string[] = ["2026.3"];

// §4.1 / §5.2 — same 45/45/10 weighting applies to both live Ability Scores
// and diagnostic-pattern values (the formula shape is identical; only the
// inputs differ, per §5.1's "same pattern, two different tables" design).
export const READING_WRITING_WEIGHTS = {
  readingComprehension: 0.45,
  grammar: 0.45,
  vocabulary: 0.1,
};

// §4.2 / §5.3
export const MATH_WEIGHTS = {
  algebra: 0.35,
  advancedMath: 0.35,
  problemSolving: 0.15,
  geometryTrigonometry: 0.15,
};

export const CATEGORY_WEIGHT: Record<QuestionCategory, number> = {
  READING_COMPREHENSION: READING_WRITING_WEIGHTS.readingComprehension,
  GRAMMAR: READING_WRITING_WEIGHTS.grammar,
  VOCABULARY: READING_WRITING_WEIGHTS.vocabulary,
  ALGEBRA: MATH_WEIGHTS.algebra,
  ADVANCED_MATH: MATH_WEIGHTS.advancedMath,
  PROBLEM_SOLVING_DATA_ANALYSIS: MATH_WEIGHTS.problemSolving,
  GEOMETRY_TRIGONOMETRY: MATH_WEIGHTS.geometryTrigonometry,
};

// What turns ability into an SAT score, and the one assumption in the
// engine that PrepHub's own data can't check: there is no official score
// to compare against yet. College Board assigns every question to the
// lowest of seven section-score bands whose students answer it correctly at
// least 67% of the time ("RP67", Skills Insight for the SAT Suite, technical
// appendix), and its Easy, Medium and Hard are bands 1-3, 4-5 and 6-7. So
// each value below is the section score at which a typical question of that
// difficulty is answered right two times in three. The engine finds the
// ability at which PrepHub's students do the same (from DIFFICULTY_RATING)
// and draws one straight line through the three pairs, per section.
//
// It assumes PrepHub's difficulty labels mean what College Board's do. When
// official scores exist, refit these six numbers against them, under a new
// SCORING_ENGINE_VERSION.
export const SECTION_SCORE_ANCHORS: Record<ScoreSection, Record<QuestionDifficulty, number>> = {
  // Bands 2-3 (370-480), 4-5 (490-600), 6-7 (610-800, mostly 6).
  READING_WRITING: { EASY: 425, MEDIUM: 545, HARD: 660 },
  // Math's band 3 is 420-460 and band 4 is 470-540.
  MATH: { EASY: 415, MEDIUM: 535, HARD: 660 },
};

/** Probability at which College Board places a question in a band. */
export const ANCHOR_RESPONSE_PROBABILITY = 0.67;

export type SectionScoreLine = { intercept: number; slope: number };

const DIFFICULTIES: QuestionDifficulty[] = ["EASY", "MEDIUM", "HARD"];

/**
 * Least-squares line through (ability where a typical question of each
 * difficulty is answered right 67% of the time, that difficulty's anchor
 * score). A section's "typical question" weights the categories as the
 * section score does.
 */
export function sectionScoreLine(section: ScoreSection): SectionScoreLine {
  const categories = ALL_CATEGORIES.filter((c) => CATEGORY_SECTION[c] === section);
  const offset = Math.log(ANCHOR_RESPONSE_PROBABILITY / (1 - ANCHOR_RESPONSE_PROBABILITY)) / ABILITY_LOGISTIC_SCALE;
  const points = DIFFICULTIES.map((d) => ({
    x: categories.reduce((sum, c) => sum + CATEGORY_WEIGHT[c] * questionRating(c, d), 0) + offset,
    y: SECTION_SCORE_ANCHORS[section][d],
  }));
  const meanX = points.reduce((a, p) => a + p.x, 0) / points.length;
  const meanY = points.reduce((a, p) => a + p.y, 0) / points.length;
  const slope =
    points.reduce((a, p) => a + (p.x - meanX) * (p.y - meanY), 0) / points.reduce((a, p) => a + (p.x - meanX) ** 2, 0);
  return { intercept: meanY - slope * meanX, slope };
}

export const SECTION_SCORE_LINES: Record<ScoreSection, SectionScoreLine> = {
  READING_WRITING: sectionScoreLine("READING_WRITING"),
  MATH: sectionScoreLine("MATH"),
};

/** A section ability as an SAT section score, unrounded, within 200-800. */
export function sectionScoreFromAbility(section: ScoreSection, ability: number): number {
  const line = SECTION_SCORE_LINES[section];
  return clamp(line.intercept + line.slope * ability, 200, 800);
}

/** The section ability whose score is `score`: the inverse of sectionScoreFromAbility. */
export function abilityForSectionScore(section: ScoreSection, score: number): number {
  const line = SECTION_SCORE_LINES[section];
  return (score - line.intercept) / line.slope;
}

// §2 (displayed ranges), §7 (representative midpoints) — the fifteen bands a
// prediction is shown as. abilityMin/abilityMax are engine 2026.1's
// nonlinear Ability→range mapping (§6), kept only to read entries written
// under it (rangeForAbility); no current prediction uses them.
export type ScoreRange = {
  index: number;
  scoreMin: number;
  scoreMax: number;
  midpoint: number;
  abilityMin: number;
  abilityMax: number;
};

export const SCORE_RANGES: ScoreRange[] = [
  { index: 1, scoreMin: 400, scoreMax: 480, midpoint: 440, abilityMin: 0.0, abilityMax: 10.0 },
  { index: 2, scoreMin: 490, scoreMax: 560, midpoint: 525, abilityMin: 10.0, abilityMax: 16.0 },
  { index: 3, scoreMin: 570, scoreMax: 640, midpoint: 605, abilityMin: 16.0, abilityMax: 26.0 },
  { index: 4, scoreMin: 650, scoreMax: 720, midpoint: 685, abilityMin: 26.0, abilityMax: 30.0 },
  { index: 5, scoreMin: 730, scoreMax: 800, midpoint: 765, abilityMin: 30.0, abilityMax: 33.0 },
  { index: 6, scoreMin: 810, scoreMax: 880, midpoint: 845, abilityMin: 33.0, abilityMax: 36.0 },
  { index: 7, scoreMin: 890, scoreMax: 960, midpoint: 925, abilityMin: 36.0, abilityMax: 39.0 },
  { index: 8, scoreMin: 970, scoreMax: 1040, midpoint: 1005, abilityMin: 39.0, abilityMax: 43.0 },
  { index: 9, scoreMin: 1050, scoreMax: 1120, midpoint: 1085, abilityMin: 43.0, abilityMax: 47.0 },
  { index: 10, scoreMin: 1130, scoreMax: 1200, midpoint: 1165, abilityMin: 47.0, abilityMax: 53.0 },
  { index: 11, scoreMin: 1210, scoreMax: 1280, midpoint: 1245, abilityMin: 53.0, abilityMax: 61.0 },
  { index: 12, scoreMin: 1290, scoreMax: 1360, midpoint: 1325, abilityMin: 61.0, abilityMax: 70.0 },
  { index: 13, scoreMin: 1370, scoreMax: 1440, midpoint: 1405, abilityMin: 70.0, abilityMax: 82.0 },
  { index: 14, scoreMin: 1450, scoreMax: 1520, midpoint: 1485, abilityMin: 82.0, abilityMax: 89.0 },
  { index: 15, scoreMin: 1530, scoreMax: 1600, midpoint: 1565, abilityMin: 89.0, abilityMax: 100.0 },
];

// §5.4 range mapping / §13.1 rangeContainingScore — bands are ascending and
// contiguous; the diagnostic estimate's own band is the highest whose
// scoreMin it meets or exceeds. Score 1600 correctly lands in the top band
// since bands are checked from the top down.
export function rangeForScore(score: number): ScoreRange {
  for (let i = SCORE_RANGES.length - 1; i >= 0; i--) {
    if (score >= SCORE_RANGES[i].scoreMin) return SCORE_RANGES[i];
  }
  return SCORE_RANGES[0];
}

// §6 / §13.2 rangeForOverallAbility, engine 2026.1 only — same top-down band
// search over that engine's nonlinear Ability thresholds.
export function rangeForAbility(ability: number): ScoreRange {
  for (let i = SCORE_RANGES.length - 1; i >= 0; i--) {
    if (ability >= SCORE_RANGES[i].abilityMin) return SCORE_RANGES[i];
  }
  return SCORE_RANGES[0];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// §8.1 positionInsideAbilityThreshold / §8.2 positionInsideScoreRange — same
// shape, different units (ability points vs. SAT points).
export function progressWithinRange(value: number, min: number, max: number): number {
  if (max === min) return 1;
  return clamp((value - min) / (max - min), 0, 1);
}

// §11 "Configuration validation" — run once at module load so a broken
// config fails immediately and loudly rather than silently mispricing
// predictions. Not meant to be called per-request.
export function validateScoreConfig(): void {
  const rwSum = Object.values(READING_WRITING_WEIGHTS).reduce((a, b) => a + b, 0);
  if (Math.abs(rwSum - 1.0) > 1e-9) throw new Error(`Reading/Writing weights must sum to 1.0, got ${rwSum}`);

  const mathSum = Object.values(MATH_WEIGHTS).reduce((a, b) => a + b, 0);
  if (Math.abs(mathSum - 1.0) > 1e-9) throw new Error(`Math weights must sum to 1.0, got ${mathSum}`);

  const sortedByIndex = [...SCORE_RANGES].sort((a, b) => a.index - b.index);
  if (sortedByIndex[0].scoreMin !== 400 || sortedByIndex[sortedByIndex.length - 1].scoreMax !== 1600) {
    throw new Error("Score ranges must cover 400-1600");
  }
  if (sortedByIndex[0].abilityMin !== 0.0 || sortedByIndex[sortedByIndex.length - 1].abilityMax !== 100.0) {
    throw new Error("Ability thresholds must cover 0.0-100.0");
  }
  for (let i = 1; i < sortedByIndex.length; i++) {
    const prev = sortedByIndex[i - 1];
    const cur = sortedByIndex[i];
    if (cur.scoreMin <= prev.scoreMax) throw new Error(`Score ranges overlap or are unordered at index ${cur.index}`);
    if (cur.abilityMin !== prev.abilityMax) throw new Error(`Ability thresholds have a gap or overlap at index ${cur.index}`);
    if (cur.index !== prev.index + 1) throw new Error("Score ranges must be ascending and contiguous by index");
  }

  for (const section of ["READING_WRITING", "MATH"] as const) {
    const anchors = SECTION_SCORE_ANCHORS[section];
    if (!(anchors.EASY < anchors.MEDIUM && anchors.MEDIUM < anchors.HARD)) {
      throw new Error(`${section} anchors must rise from Easy to Hard`);
    }
    if (!(SECTION_SCORE_LINES[section].slope > 0)) throw new Error(`${section} score line must rise with ability`);
  }
}

validateScoreConfig();
