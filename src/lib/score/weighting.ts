import { MATH_WEIGHTS, READING_WRITING_WEIGHTS } from "./config";

// PRD-016 §4 / §5.2-§5.3 — identical weighting shape for both live Ability
// Scores and diagnostic-pattern values; only the caller's inputs differ.
export function readingWritingValue(readingComprehension: number, grammar: number, vocabulary: number): number {
  return (
    READING_WRITING_WEIGHTS.readingComprehension * readingComprehension +
    READING_WRITING_WEIGHTS.grammar * grammar +
    READING_WRITING_WEIGHTS.vocabulary * vocabulary
  );
}

export function mathValue(algebra: number, advancedMath: number, problemSolving: number, geometryTrigonometry: number): number {
  return (
    MATH_WEIGHTS.algebra * algebra +
    MATH_WEIGHTS.advancedMath * advancedMath +
    MATH_WEIGHTS.problemSolving * problemSolving +
    MATH_WEIGHTS.geometryTrigonometry * geometryTrigonometry
  );
}

// §4.3 / §5.4
export function overallValue(readingWriting: number, math: number): number {
  return (readingWriting + math) / 2;
}
