import { describe, it, expect } from "vitest";
import { chanceFor, discussTier, harderTier, planClassQuestions, startTier, suggestMove, tierFallback } from "./plan";

describe("planClassQuestions", () => {
  it("pitches a typical class: an easy start, a medium to discuss, a hard stretch", () => {
    const plan = planClassQuestions(60, 3);
    expect(plan.map((p) => [p.role, p.difficulty])).toEqual([
      ["START", "EASY"],
      ["DISCUSS", "MEDIUM"],
      ["STRETCH", "HARD"],
    ]);
    expect(plan[1].chance).toBeCloseTo(0.5);
    expect(plan[0].chance!).toBeGreaterThan(0.7);
  });

  it("moves everything down for a class still building", () => {
    // At 36, even Easy is about a coin flip, so Easy is the one to discuss.
    const plan = planClassQuestions(36, 3);
    expect(plan.map((p) => p.difficulty)).toEqual(["EASY", "EASY", "MEDIUM"]);
  });

  it("moves everything up for a strong class", () => {
    const plan = planClassQuestions(90, 3);
    expect(plan.map((p) => p.difficulty)).toEqual(["MEDIUM", "HARD", "HARD"]);
  });

  it("falls back to easy, medium, hard with no data, and gives no chance", () => {
    const plan = planClassQuestions(null, 3);
    expect(plan.map((p) => p.difficulty)).toEqual(["EASY", "MEDIUM", "HARD"]);
    expect(plan.every((p) => p.chance === null)).toBe(true);
  });

  it("shapes shorter and longer sessions", () => {
    expect(planClassQuestions(60, 2).map((p) => p.role)).toEqual(["START", "DISCUSS"]);
    expect(planClassQuestions(60, 4).map((p) => p.role)).toEqual(["START", "DISCUSS", "DISCUSS", "STRETCH"]);
    expect(planClassQuestions(60, 1).map((p) => p.role)).toEqual(["DISCUSS"]);
  });
});

describe("tiers", () => {
  it("steps up one tier, capped at hard", () => {
    expect(harderTier("EASY")).toBe("MEDIUM");
    expect(harderTier("MEDIUM")).toBe("HARD");
    expect(harderTier("HARD")).toBe("HARD");
  });

  it("falls back to the nearest tier first", () => {
    expect(tierFallback("EASY")).toEqual(["EASY", "MEDIUM", "HARD"]);
    expect(tierFallback("MEDIUM")).toEqual(["MEDIUM", "EASY", "HARD"]);
    expect(tierFallback("HARD")).toEqual(["HARD", "MEDIUM", "EASY"]);
  });

  it("chooses a start and a discussion tier from the chance model", () => {
    expect(startTier(null)).toBe("EASY");
    expect(startTier(10)).toBe("EASY");
    expect(discussTier(null)).toBe("MEDIUM");
    expect(discussTier(85)).toBe("HARD");
    expect(chanceFor("MEDIUM", 60)).toBeCloseTo(0.5);
  });
});

describe("suggestMove", () => {
  it("moves on above 70%, talks from 35% to 70%, explains below 35%", () => {
    expect(suggestMove(0.71)).toBe("MOVE_ON");
    expect(suggestMove(0.7)).toBe("TALK");
    expect(suggestMove(0.43)).toBe("TALK");
    expect(suggestMove(0.35)).toBe("TALK");
    expect(suggestMove(0.34)).toBe("EXPLAIN");
    expect(suggestMove(0)).toBe("EXPLAIN");
  });

  it("suggests nothing before anyone has answered", () => {
    expect(suggestMove(null)).toBeNull();
  });
});
