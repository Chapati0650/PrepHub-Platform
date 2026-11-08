import { describe, expect, it } from "vitest";
import {
  TSI_MATH_BENCHMARK,
  TSI_READING_WRITING_BENCHMARK,
  classifyBenchmarkMovement,
  shapeOfShortfall,
  tsiStatusForEntry,
  tsiStatusFromScores,
} from "./ccmr";
import { sectionScoresForEntry } from "./section-scores";
import { LEGACY_SCORING_VERSION, SCORING_ENGINE_VERSION, rangeForAbility, sectionScoreFromAbility } from "./config";

describe("sectionScoreFromAbility", () => {
  it("is monotonic across the ability scale, in both sections", () => {
    for (const section of ["READING_WRITING", "MATH"] as const) {
      let previous = -Infinity;
      for (let ability = 0; ability <= 100; ability += 1) {
        const score = sectionScoreFromAbility(section, ability);
        expect(score).toBeGreaterThanOrEqual(previous);
        previous = score;
      }
    }
  });

  it("stays inside the real SAT section range", () => {
    for (const section of ["READING_WRITING", "MATH"] as const) {
      for (let ability = 0; ability <= 100; ability += 0.5) {
        const score = sectionScoreFromAbility(section, ability);
        expect(score).toBeGreaterThanOrEqual(200);
        expect(score).toBeLessThanOrEqual(800);
      }
    }
  });
});

describe("sectionScoresForEntry", () => {
  const entry = (overrides: Partial<Parameters<typeof sectionScoresForEntry>[0]>) => ({
    sourceType: "ADAPTIVE_SET" as const,
    scoringEngineVersion: SCORING_ENGINE_VERSION,
    readingWritingAbility: 50,
    mathAbility: 50,
    ...overrides,
  });

  it("reads a current entry's abilities on the current section lines, to the 10 the real SAT reports", () => {
    for (const sourceType of ["DIAGNOSTIC", "ADAPTIVE_SET"] as const) {
      expect(sectionScoresForEntry(entry({ sourceType, readingWritingAbility: 61, mathAbility: 47 }))).toEqual({
        readingWriting: Math.round(sectionScoreFromAbility("READING_WRITING", 61) / 10) * 10,
        math: Math.round(sectionScoreFromAbility("MATH", 47) / 10) * 10,
      });
    }
  });

  it("reads a 2026.2 entry on the same lines to the nearest point, never re-scored to 10", () => {
    for (const sourceType of ["DIAGNOSTIC", "ADAPTIVE_SET"] as const) {
      expect(
        sectionScoresForEntry(entry({ sourceType, scoringEngineVersion: "2026.2", readingWritingAbility: 61, mathAbility: 47 })),
      ).toEqual({
        readingWriting: Math.round(sectionScoreFromAbility("READING_WRITING", 61)),
        math: Math.round(sectionScoreFromAbility("MATH", 47)),
      });
    }
  });

  it("reads a 2026.1 Practice Set entry through that engine's ability table", () => {
    expect(sectionScoresForEntry(entry({ scoringEngineVersion: LEGACY_SCORING_VERSION, readingWritingAbility: 65, mathAbility: 30 }))).toEqual({
      readingWriting: Math.round(rangeForAbility(65).midpoint / 2),
      math: Math.round(rangeForAbility(30).midpoint / 2),
    });
  });

  it("reads a 2026.1 Diagnostic entry's 400-1600 pattern values as twice the section score", () => {
    // The old reader put 1000 through the ability table, where anything from
    // 89 up is the top band: about 783 a section, college-ready on day one.
    expect(
      sectionScoresForEntry(
        entry({ sourceType: "DIAGNOSTIC", scoringEngineVersion: LEGACY_SCORING_VERSION, readingWritingAbility: 1000, mathAbility: 880 }),
      ),
    ).toEqual({ readingWriting: 500, math: 440 });
  });

  it("returns null for a missing value or an engine it can't read", () => {
    expect(sectionScoresForEntry(entry({ mathAbility: null }))).toBeNull();
    expect(sectionScoresForEntry(entry({ scoringEngineVersion: "2025.9" }))).toBeNull();
  });
});

describe("tsiStatusFromScores", () => {
  it("requires both criteria, not a strong total", () => {
    const status = tsiStatusFromScores(400, 700);
    expect(status.meetsMath).toBe(true);
    expect(status.meetsReadingWriting).toBe(false);
    expect(status.meetsTsi).toBe(false);
  });

  it("fails a student who clears reading but misses math", () => {
    // The common real shape — and the one the district report leads with.
    const status = tsiStatusFromScores(560, 470);
    expect(status.meetsReadingWriting).toBe(true);
    expect(status.meetsMath).toBe(false);
    expect(status.meetsTsi).toBe(false);
  });

  it("treats a score exactly on a benchmark as meeting it", () => {
    const status = tsiStatusFromScores(TSI_READING_WRITING_BENCHMARK, TSI_MATH_BENCHMARK);
    expect(status.meetsReadingWriting).toBe(true);
    expect(status.meetsMath).toBe(true);
    expect(status.meetsTsi).toBe(true);
  });
});

describe("tsiStatusForEntry", () => {
  it("no longer marks a 2026.1 Diagnostic college-ready because of its storage format", () => {
    const status = tsiStatusForEntry({
      sourceType: "DIAGNOSTIC",
      scoringEngineVersion: LEGACY_SCORING_VERSION,
      readingWritingAbility: 900,
      mathAbility: 900,
    });
    expect(status).not.toBeNull();
    expect(status!.meetsTsi).toBe(false);
  });

  it("is null when the entry can't be scored", () => {
    expect(tsiStatusForEntry({ sourceType: "ADAPTIVE_SET", scoringEngineVersion: SCORING_ENGINE_VERSION, readingWritingAbility: null, mathAbility: 50 })).toBeNull();
  });
});

const below = tsiStatusFromScores(400, 400);
const above = tsiStatusFromScores(700, 700);
const readingOnly = tsiStatusFromScores(560, 470);

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
    expect(shapeOfShortfall(tsiStatusFromScores(400, 700))).toBe("MISSES_READING_ONLY");
  });

  it("identifies a both-subject shortfall", () => {
    expect(shapeOfShortfall(below)).toBe("MISSES_BOTH");
  });
});
