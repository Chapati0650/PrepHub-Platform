// PRD-016 §11 "Configuration and Versioning" — every tunable value the
// Predicted SAT Score Engine uses lives here. Bumping SCORING_ENGINE_VERSION
// on any change to this file is how historical PredictionHistoryEntry rows
// stay honest about which rules produced them — configuration changes must
// never rewrite prediction history retroactively (§11, §14).
export const SCORING_ENGINE_VERSION = "2026.1";

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

// §5.1 — separate from PRD-014's DIAGNOSTIC_ABILITY_INITIALIZATION table.
// Keyed identically ("E{0|1}M{0|1}H{0|1}") via diagnosticPatternKey, shared
// with the adaptive engine so both tables read the same result pattern.
export const DIAGNOSTIC_PATTERN_VALUES: Record<string, number> = {
  E0M0H0: 400,
  E1M0H0: 1000,
  E0M1H0: 800,
  E1M1H0: 1300,
  E0M0H1: 600,
  E1M0H1: 1200,
  E0M1H1: 1000,
  E1M1H1: 1600,
};

// §2 (displayed ranges), §6 (post-diagnostic Ability→range mapping), §7
// (representative midpoints) — one table carries all three since they're
// index-aligned 1:1. abilityMin/abilityMax bound the *nonlinear* Ability
// band that maps to this same score range (§6); scoreMin/scoreMax are also
// used directly as the diagnostic-estimate band (§5.4 range mapping table).
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

// §6 / §13.2 rangeForOverallAbility — same top-down band search, over the
// nonlinear Ability thresholds instead of raw SAT score thresholds.
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

  const patternKeys = Object.keys(DIAGNOSTIC_PATTERN_VALUES);
  if (patternKeys.length !== 8) throw new Error(`Expected exactly 8 diagnostic patterns, got ${patternKeys.length}`);
  for (const value of Object.values(DIAGNOSTIC_PATTERN_VALUES)) {
    if (value < 400 || value > 1600) throw new Error(`Diagnostic pattern value ${value} out of 400-1600 range`);
  }
}

validateScoreConfig();
