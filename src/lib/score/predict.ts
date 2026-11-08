import type { QuestionCategory } from "@/generated/prisma/client";
import type { ScoredAnswer } from "@/lib/adaptive/estimate";
import { clamp, sectionScoreFromAbility } from "./config";
import { BAND_MIN_HALF_WIDTH, BAND_Z, roundToStep, sectionScoreSd } from "./real-test";
import { mathValue, overallValue, readingWritingValue } from "./weighting";

export type ScoreBand = { score: number; low: number; high: number };

export type ScorePrediction = {
  readingWritingAbility: number;
  mathAbility: number;
  overallAbility: number;
  /** Each section as the real SAT reports it: 200-800 in steps of 10, with its likely band. */
  readingWriting: ScoreBand;
  math: ScoreBand;
  readingWritingScore: number;
  mathScore: number;
  /** The unrounded total, before the reporting step. */
  totalScore: number;
  /** The predicted total: the two reported section scores added, 400-1600. */
  point: number;
  /** The likely band around the total (about 80%), in steps of 10. */
  low: number;
  high: number;
};

function band(score: number, sd: number, min: number, max: number): ScoreBand {
  const half = Math.max(BAND_Z * sd, BAND_MIN_HALF_WIDTH);
  return {
    score,
    low: clamp(roundToStep(score - half), min, score),
    high: clamp(roundToStep(score + half), score, max),
  };
}

/**
 * PRD-016 §13 — the one way abilities become a Predicted SAT Score, for the
 * Diagnostic and every Practice Set alike. Each section is scored on its own
 * line (SECTION_SCORE_LINES) and reported the way the SAT reports it: rounded
 * to 10, the two added for the total. The band is the estimate's own
 * uncertainty (sectionScoreSd, from `answers`), combined across sections as
 * independent: "1240, likely 1190-1290".
 *
 * Because the Diagnostic's prediction is this function of the abilities the
 * Diagnostic leaves behind, a set that changes nothing changes nothing. Pass
 * every answer the abilities were estimated from; without any, the band is the
 * prior's, which is very wide.
 */
export function predictScore(abilities: Record<QuestionCategory, number>, answers: readonly ScoredAnswer[] = []): ScorePrediction {
  const rw = readingWritingValue(abilities.READING_COMPREHENSION, abilities.GRAMMAR, abilities.VOCABULARY);
  const math = mathValue(
    abilities.ALGEBRA,
    abilities.ADVANCED_MATH,
    abilities.PROBLEM_SOLVING_DATA_ANALYSIS,
    abilities.GEOMETRY_TRIGONOMETRY,
  );
  const rwUnrounded = sectionScoreFromAbility("READING_WRITING", rw);
  const mathUnrounded = sectionScoreFromAbility("MATH", math);
  const rwSd = sectionScoreSd("READING_WRITING", answers, abilities);
  const mathSd = sectionScoreSd("MATH", answers, abilities);

  const readingWriting = band(roundToStep(rwUnrounded), rwSd, 200, 800);
  const mathBand = band(roundToStep(mathUnrounded), mathSd, 200, 800);
  const point = readingWriting.score + mathBand.score;
  const total = band(point, Math.sqrt(rwSd ** 2 + mathSd ** 2), 400, 1600);

  return {
    readingWritingAbility: rw,
    mathAbility: math,
    overallAbility: overallValue(rw, math),
    readingWriting,
    math: mathBand,
    readingWritingScore: readingWriting.score,
    mathScore: mathBand.score,
    totalScore: rwUnrounded + mathUnrounded,
    point,
    low: total.low,
    high: total.high,
  };
}
