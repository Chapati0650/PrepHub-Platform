import { describe, it, expect } from "vitest";
import { compareRuns, isOverLimit, scoreRushAnswer } from "./scoring";
import { RUSH_BASE_POINTS, RUSH_GRACE_MS, RUSH_SPEED_POINTS } from "./config";

const LIMIT = 60_000;

describe("scoreRushAnswer", () => {
  it("gives full base + full speed bonus for an instant correct answer", () => {
    expect(scoreRushAnswer({ isCorrect: true, elapsedMs: 0, limitMs: LIMIT })).toBe(RUSH_BASE_POINTS + RUSH_SPEED_POINTS);
  });

  it("scales the speed bonus linearly with time left", () => {
    expect(scoreRushAnswer({ isCorrect: true, elapsedMs: LIMIT / 2, limitMs: LIMIT })).toBe(RUSH_BASE_POINTS + RUSH_SPEED_POINTS / 2);
    expect(scoreRushAnswer({ isCorrect: true, elapsedMs: LIMIT * 0.75, limitMs: LIMIT })).toBe(RUSH_BASE_POINTS + RUSH_SPEED_POINTS / 4);
  });

  it("gives only the base points for a correct answer at the buzzer", () => {
    expect(scoreRushAnswer({ isCorrect: true, elapsedMs: LIMIT, limitMs: LIMIT })).toBe(RUSH_BASE_POINTS);
  });

  it("still scores a correct answer that lands inside the network grace window", () => {
    expect(scoreRushAnswer({ isCorrect: true, elapsedMs: LIMIT + RUSH_GRACE_MS, limitMs: LIMIT })).toBe(RUSH_BASE_POINTS);
  });

  it("gives zero for a correct answer past the grace window", () => {
    expect(scoreRushAnswer({ isCorrect: true, elapsedMs: LIMIT + RUSH_GRACE_MS + 1, limitMs: LIMIT })).toBe(0);
  });

  it("gives zero for a wrong answer regardless of speed — never negative", () => {
    expect(scoreRushAnswer({ isCorrect: false, elapsedMs: 0, limitMs: LIMIT })).toBe(0);
    expect(scoreRushAnswer({ isCorrect: false, elapsedMs: LIMIT * 2, limitMs: LIMIT })).toBe(0);
  });

  it("never exceeds the maximum even if elapsed is somehow negative", () => {
    expect(scoreRushAnswer({ isCorrect: true, elapsedMs: -500, limitMs: LIMIT })).toBe(RUSH_BASE_POINTS + RUSH_SPEED_POINTS);
  });
});

describe("isOverLimit", () => {
  it("is false inside the grace window and true past it", () => {
    expect(isOverLimit(LIMIT + RUSH_GRACE_MS, LIMIT)).toBe(false);
    expect(isOverLimit(LIMIT + RUSH_GRACE_MS + 1, LIMIT)).toBe(true);
  });
});

describe("compareRuns", () => {
  it("decides by score first", () => {
    expect(compareRuns({ score: 900, totalMs: 500_000 }, { score: 800, totalMs: 100_000 })).toBe("WON");
    expect(compareRuns({ score: 700, totalMs: 100_000 }, { score: 800, totalMs: 500_000 })).toBe("LOST");
  });

  it("breaks a score tie by the faster total time", () => {
    expect(compareRuns({ score: 800, totalMs: 100_000 }, { score: 800, totalMs: 120_000 })).toBe("WON");
    expect(compareRuns({ score: 800, totalMs: 130_000 }, { score: 800, totalMs: 120_000 })).toBe("LOST");
  });

  it("is a tie only when score and time both match", () => {
    expect(compareRuns({ score: 800, totalMs: 120_000 }, { score: 800, totalMs: 120_000 })).toBe("TIED");
  });
});
