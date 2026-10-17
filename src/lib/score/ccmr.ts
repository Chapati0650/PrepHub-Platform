import { rangeForAbility } from "./config";

/**
 * Texas Success Initiative (TSI) benchmarks, as met via SAT section scores.
 *
 * A graduate demonstrates college readiness for CCMR purposes partly by
 * meeting TSI criteria, and the SAT route to TSI requires *both* section
 * benchmarks on the same route. A strong total is not enough: the common
 * real case is a student who clears Reading & Writing comfortably and misses
 * Math, and that student earns the district nothing. That is why `meetsTsi`
 * is an AND, and why the two criteria are also reported separately — the
 * one-criterion-short group is the cheapest to move.
 *
 * Source: Texas Education Agency, "CCMR Outcomes Bonus" (28 August 2025) for
 * the readiness definition; the SAT section thresholds are the long-standing
 * TSI exemption scores.
 */
export const TSI_READING_WRITING_BENCHMARK = 480;
export const TSI_MATH_BENCHMARK = 530;

/**
 * Converts a per-section Ability (the `readingWritingAbility` /
 * `mathAbility` stored on a PredictionHistoryEntry) into an estimated SAT
 * section score on the 200-800 scale.
 *
 * The scoring config maps Ability to a *total* 400-1600 band. Since those
 * bands are symmetric across the two sections, running a single section's
 * Ability through the same table and halving the representative midpoint
 * gives that section's equivalent. This is an estimate layered on an
 * estimate and is only ever used for aggregate school reporting — never
 * shown to a student as their section score, and never written back into a
 * PredictionHistoryEntry.
 */
export function sectionScoreFromAbility(ability: number): number {
  return Math.round(rangeForAbility(ability).midpoint / 2);
}

export type TsiStatus = {
  readingWritingScore: number;
  mathScore: number;
  meetsReadingWriting: boolean;
  meetsMath: boolean;
  /** Both criteria on the same route — the only combination that counts. */
  meetsTsi: boolean;
};

export function tsiStatusFromAbilities(
  readingWritingAbility: number,
  mathAbility: number,
): TsiStatus {
  const readingWritingScore = sectionScoreFromAbility(readingWritingAbility);
  const mathScore = sectionScoreFromAbility(mathAbility);
  const meetsReadingWriting = readingWritingScore >= TSI_READING_WRITING_BENCHMARK;
  const meetsMath = mathScore >= TSI_MATH_BENCHMARK;
  return {
    readingWritingScore,
    mathScore,
    meetsReadingWriting,
    meetsMath,
    meetsTsi: meetsReadingWriting && meetsMath,
  };
}

export type BenchmarkMovement =
  /** Was below on at least one criterion, now meets both. The one that pays. */
  | "CROSSED"
  /** Met both at the start and still does. */
  | "HELD"
  /** Met both at the start, no longer does. */
  | "SLIPPED"
  /** Below at the start and still below. */
  | "BELOW";

/**
 * Classifies one student's movement across the TSI benchmark between their
 * first and latest prediction.
 *
 * Deliberately a pure function over two already-computed statuses: the caller
 * decides which entries count as "first" and "latest", and this decides only
 * what the pair means. CROSSED is the number a district cares about, because
 * it is the group that converts into a CCMR Outcomes Bonus.
 */
export function classifyBenchmarkMovement(first: TsiStatus, latest: TsiStatus): BenchmarkMovement {
  if (!first.meetsTsi && latest.meetsTsi) return "CROSSED";
  if (first.meetsTsi && latest.meetsTsi) return "HELD";
  if (first.meetsTsi && !latest.meetsTsi) return "SLIPPED";
  return "BELOW";
}

/**
 * Of the students still below the benchmark, how close is each? A student
 * missing only one criterion is the next-cheapest credit a campus can earn,
 * which is the distinction the admin report leads with.
 */
export type BelowBenchmarkShape = "MISSES_MATH_ONLY" | "MISSES_READING_ONLY" | "MISSES_BOTH";

export function shapeOfShortfall(status: TsiStatus): BelowBenchmarkShape | null {
  if (status.meetsTsi) return null;
  if (status.meetsReadingWriting && !status.meetsMath) return "MISSES_MATH_ONLY";
  if (!status.meetsReadingWriting && status.meetsMath) return "MISSES_READING_ONLY";
  return "MISSES_BOTH";
}
