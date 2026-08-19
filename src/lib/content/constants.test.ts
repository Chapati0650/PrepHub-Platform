import { describe, expect, it } from "vitest";
import { getCalculatorSettingForCategory, getSuggestedTimeForDifficulty } from "@/lib/content/constants";

describe("getCalculatorSettingForCategory", () => {
  it.each([
    ["ALGEBRA", "ALLOWED"],
    ["GEOMETRY_TRIGONOMETRY", "ALLOWED"],
    ["ADVANCED_MATH", "ALLOWED"],
    ["PROBLEM_SOLVING_DATA_ANALYSIS", "ALLOWED"],
    ["READING_COMPREHENSION", "NOT_ALLOWED"],
    ["GRAMMAR", "NOT_ALLOWED"],
    ["VOCABULARY", "NOT_ALLOWED"],
  ] as const)("%s → %s", (category, expected) => {
    expect(getCalculatorSettingForCategory(category)).toBe(expected);
  });
});

describe("getSuggestedTimeForDifficulty", () => {
  it.each([
    ["EASY", 60],
    ["MEDIUM", 90],
    ["HARD", 180],
  ] as const)("%s → %s seconds", (difficulty, expected) => {
    expect(getSuggestedTimeForDifficulty(difficulty)).toBe(expected);
  });
});
