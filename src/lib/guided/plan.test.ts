import { describe, it, expect } from "vitest";
import { chanceFor, discussTier, harderTier, planClassQuestions, startTier, suggestMove, tierFallback } from "./plan";
import { DIFFICULTY_RATING } from "@/lib/adaptive/config";

// Reading Comprehension's ratings (engine 2026.2): a class pitched at them.
const RC = DIFFICULTY_RATING.READING_COMPREHENSION;

describe("planClassQuestions", () => {
  it("pitches a typical class: an easy start, a medium to discuss, a hard stretch", () => {
    // A class whose middle student is even money on a Medium question.
    const plan = planClassQuestions("READING_COMPREHENSION", RC.MEDIUM, 3);
    expect(plan.map((p) => [p.role, p.difficulty])).toEqual([
      ["START", "EASY"],
      ["DISCUSS", "MEDIUM"],
      ["STRETCH", "HARD"],
    ]);
    expect(plan[1].chance).toBeCloseTo(0.5);
    expect(plan[0].chance!).toBeGreaterThan(0.7);
  });

  it("moves everything down for a class still building", () => {
    // At the Easy rating, Easy itself is a coin flip, so Easy is the one to discuss.
    const plan = planClassQuestions("READING_COMPREHENSION", RC.EASY, 3);
    expect(plan.map((p) => p.difficulty)).toEqual(["EASY", "EASY", "MEDIUM"]);
  });

  it("moves everything up for a strong class", () => {
    const plan = planClassQuestions("READING_COMPREHENSION", RC.HARD + 10, 3);
    expect(plan.map((p) => p.difficulty)).toEqual(["MEDIUM", "HARD", "HARD"]);
  });

  it("falls back to easy, medium, hard with no data, and gives no chance", () => {
    const plan = planClassQuestions("READING_COMPREHENSION", null, 3);
    expect(plan.map((p) => p.difficulty)).toEqual(["EASY", "MEDIUM", "HARD"]);
    expect(plan.every((p) => p.chance === null)).toBe(true);
  });

  it("shapes shorter and longer sessions", () => {
    expect(planClassQuestions("ALGEBRA", 50, 2).map((p) => p.role)).toEqual(["START", "DISCUSS"]);
    expect(planClassQuestions("ALGEBRA", 50, 4).map((p) => p.role)).toEqual(["START", "DISCUSS", "DISCUSS", "STRETCH"]);
    expect(planClassQuestions("ALGEBRA", 50, 1).map((p) => p.role)).toEqual(["DISCUSS"]);
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
    expect(startTier("READING_COMPREHENSION", null)).toBe("EASY");
    expect(startTier("READING_COMPREHENSION", 10)).toBe("EASY");
    expect(discussTier("READING_COMPREHENSION", null)).toBe("MEDIUM");
    expect(discussTier("READING_COMPREHENSION", 85)).toBe("HARD");
    expect(chanceFor("READING_COMPREHENSION", "MEDIUM", RC.MEDIUM)).toBeCloseTo(0.5);
  });

  it("reads each skill's own ratings", () => {
    // One level, two skills: Vocabulary's Medium questions are far easier
    // for PrepHub's students than Geometry's.
    expect(chanceFor("VOCABULARY", "MEDIUM", 45)).toBeGreaterThan(chanceFor("GEOMETRY_TRIGONOMETRY", "MEDIUM", 45));
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
