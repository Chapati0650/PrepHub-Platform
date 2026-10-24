import { describe, it, expect } from "vitest";
import { compareRuns, isOverLimit, scoreRushAnswer, streakBonus, streakBefore, scoreRushAnswerWithStreak, maxRushScore } from "./scoring";
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

describe("streakBonus", () => {
  it("adds nothing for the first correct answer in a row", () => {
    expect(streakBonus(1)).toBe(0);
  });

  it("adds a step for each correct answer in a row after the first", () => {
    expect(streakBonus(2)).toBe(20);
    expect(streakBonus(3)).toBe(40);
    expect(streakBonus(5)).toBe(80);
  });

  it("caps at the sixth in a row", () => {
    expect(streakBonus(6)).toBe(100);
    expect(streakBonus(10)).toBe(100);
  });

  it("is never negative", () => {
    expect(streakBonus(0)).toBe(0);
  });
});

describe("streakBefore", () => {
  it("counts the scoring answers immediately before a position", () => {
    const answers = [
      { position: 0, points: 0 },
      { position: 1, points: 150 },
      { position: 2, points: 180 },
    ];
    expect(streakBefore(answers, 3)).toBe(2);
  });

  it("stops at the first answer that scored nothing", () => {
    const answers = [
      { position: 0, points: 150 },
      { position: 1, points: 0 },
      { position: 2, points: 150 },
    ];
    expect(streakBefore(answers, 3)).toBe(1);
  });

  it("treats a position with no answer row as a broken streak", () => {
    expect(streakBefore([{ position: 1, points: 150 }], 3)).toBe(0);
  });
});

describe("scoreRushAnswerWithStreak", () => {
  it("adds the streak bonus under scoring version 2", () => {
    const r = scoreRushAnswerWithStreak({ isCorrect: true, elapsedMs: 0, limitMs: LIMIT, previousStreak: 2, version: 2 });
    expect(r).toEqual({ points: 240, base: 100, speed: 100, streakBonus: 40, streak: 3 });
  });

  it("is exactly the original score under version 1 — a challenge keeps its rules", () => {
    const r = scoreRushAnswerWithStreak({ isCorrect: true, elapsedMs: 0, limitMs: LIMIT, previousStreak: 5, version: 1 });
    expect(r.points).toBe(scoreRushAnswer({ isCorrect: true, elapsedMs: 0, limitMs: LIMIT }));
    expect(r.streakBonus).toBe(0);
  });

  it("resets the streak and scores zero on a wrong answer", () => {
    const r = scoreRushAnswerWithStreak({ isCorrect: false, elapsedMs: 0, limitMs: LIMIT, previousStreak: 7, version: 2 });
    expect(r).toEqual({ points: 0, base: 0, speed: 0, streakBonus: 0, streak: 0 });
  });

  it("resets the streak on a correct answer past the grace window", () => {
    const r = scoreRushAnswerWithStreak({
      isCorrect: true,
      elapsedMs: LIMIT + RUSH_GRACE_MS + 1,
      limitMs: LIMIT,
      previousStreak: 3,
      version: 2,
    });
    expect(r.points).toBe(0);
    expect(r.streak).toBe(0);
  });
});

describe("maxRushScore", () => {
  it("is the original maximum under version 1", () => {
    expect(maxRushScore(1, 10)).toBe(2000);
  });

  it("includes every streak bonus a perfect run would collect under version 2", () => {
    // 200 per question, plus 0, 20, 40, 60, 80 and then 100 five times.
    expect(maxRushScore(2, 10)).toBe(2000 + 0 + 20 + 40 + 60 + 80 + 100 * 5);
  });
});
