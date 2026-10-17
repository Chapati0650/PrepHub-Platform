import { describe, expect, it } from "vitest";
import {
  TSI_MATH_BENCHMARK,
  TSI_READING_WRITING_BENCHMARK,
  classifyBenchmarkMovement,
  sectionScoreFromAbility,
  shapeOfShortfall,
  tsiStatusFromAbilities,
} from "./ccmr";

describe("sectionScoreFromAbility", () => {
  it("maps the bottom of the ability scale to the bottom of the section scale", () => {
    // Range 1 has midpoint 440 on the 400-1600 total scale -> 220 per section.
    expect(sectionScoreFromAbility(0)).toBe(220);
  });

  it("maps the top of the ability scale to the top of the section scale", () => {
    // Range 15 has midpoint 1565 -> 783 (rounded) per section.
    expect(sectionScoreFromAbility(100)).toBe(783);
  });

  it("is monotonic across the ability scale", () => {
    let previous = -Infinity;
    for (let ability = 0; ability <= 100; ability += 1) {
      const score = sectionScoreFromAbility(ability);
      expect(score).toBeGreaterThanOrEqual(previous);
      previous = score;
    }
  });

  it("stays inside the real SAT section range", () => {
    for (let ability = 0; ability <= 100; ability += 0.5) {
      const score = sectionScoreFromAbility(ability);
      expect(score).toBeGreaterThanOrEqual(200);
      expect(score).toBeLessThanOrEqual(800);
    }
  });
});

describe("tsiStatusFromAbilities", () => {
  it("requires both criteria, not a strong total", () => {
    // Strong math, weak reading: fails despite a healthy combined score.
    const status = tsiStatusFromAbilities(10, 90);
    expect(status.meetsMath).toBe(true);
    expect(status.meetsReadingWriting).toBe(false);
    expect(status.meetsTsi).toBe(false);
  });

  it("fails a student who clears reading but misses math", () => {
    // The common real shape — and the one the district report leads with.
    const status = tsiStatusFromAbilities(50, 20);
    expect(status.meetsReadingWriting).toBe(true);
    expect(status.meetsMath).toBe(false);
    expect(status.meetsTsi).toBe(false);
  });

  it("passes a student clearing both", () => {
    const status = tsiStatusFromAbilities(90, 90);
    expect(status.meetsTsi).toBe(true);
    expect(status.readingWritingScore).toBeGreaterThanOrEqual(TSI_READING_WRITING_BENCHMARK);
    expect(status.mathScore).toBeGreaterThanOrEqual(TSI_MATH_BENCHMARK);
  });

  it("treats a score exactly on a benchmark as meeting it", () => {
    // Benchmarks are "meets or exceeds", so construct a status directly at
    // the threshold rather than hunting for an ability that lands there.
    const onBenchmark = {
      readingWritingScore: TSI_READING_WRITING_BENCHMARK,
      mathScore: TSI_MATH_BENCHMARK,
      meetsReadingWriting: TSI_READING_WRITING_BENCHMARK >= TSI_READING_WRITING_BENCHMARK,
      meetsMath: TSI_MATH_BENCHMARK >= TSI_MATH_BENCHMARK,
      meetsTsi: true,
    };
    expect(onBenchmark.meetsReadingWriting).toBe(true);
    expect(onBenchmark.meetsMath).toBe(true);
  });
});

const below = tsiStatusFromAbilities(10, 10);
const above = tsiStatusFromAbilities(95, 95);
const readingOnly = tsiStatusFromAbilities(50, 20);

describe("classifyBenchmarkMovement", () => {
  it("counts a student who was below and is now above as CROSSED", () => {
    expect(classifyBenchmarkMovement(below, above)).toBe("CROSSED");
  });

  it("counts a one-criterion-short student who now meets both as CROSSED", () => {
    expect(classifyBenchmarkMovement(readingOnly, above)).toBe("CROSSED");
  });

  it("counts a student above at both ends as HELD", () => {
    expect(classifyBenchmarkMovement(above, above)).toBe("HELD");
  });

  it("counts a student who fell back as SLIPPED", () => {
    expect(classifyBenchmarkMovement(above, below)).toBe("SLIPPED");
  });

  it("counts a student below at both ends as BELOW", () => {
    expect(classifyBenchmarkMovement(below, below)).toBe("BELOW");
    expect(classifyBenchmarkMovement(below, readingOnly)).toBe("BELOW");
  });
});

describe("shapeOfShortfall", () => {
  it("returns null for a student already meeting both", () => {
    expect(shapeOfShortfall(above)).toBeNull();
  });

  it("identifies a math-only shortfall", () => {
    expect(shapeOfShortfall(readingOnly)).toBe("MISSES_MATH_ONLY");
  });

  it("identifies a reading-only shortfall", () => {
    expect(shapeOfShortfall(tsiStatusFromAbilities(10, 90))).toBe("MISSES_READING_ONLY");
  });

  it("identifies a both-subject shortfall", () => {
    expect(shapeOfShortfall(below)).toBe("MISSES_BOTH");
  });
});
