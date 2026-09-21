import { describe, it, expect } from "vitest";
import { diagnosticVerdict, weakestCategories } from "./verdict";

const mastery = [
  { category: "READING_COMPREHENSION" as const, currentMastery: 90 },
  { category: "GRAMMAR" as const, currentMastery: 88 },
  { category: "VOCABULARY" as const, currentMastery: 40 },
  { category: "ALGEBRA" as const, currentMastery: 25 },
  { category: "GEOMETRY_TRIGONOMETRY" as const, currentMastery: 65 },
  { category: "ADVANCED_MATH" as const, currentMastery: 50 },
  { category: "PROBLEM_SOLVING_DATA_ANALYSIS" as const, currentMastery: 45 },
];

describe("diagnosticVerdict", () => {
  it("names the two weakest categories, weakest first", () => {
    expect(diagnosticVerdict(mastery)).toBe("Algebra and Vocabulary are where you're losing the most points. Your first practice set is built around them.");
  });

  it("says so when everything is close to even", () => {
    const even = mastery.map((m) => ({ ...m, currentMastery: 50 + (m.category === "GRAMMAR" ? 5 : 0) }));
    expect(diagnosticVerdict(even)).toMatch(/close to even/);
  });

  it("returns null without enough categories", () => {
    expect(diagnosticVerdict([mastery[0]])).toBeNull();
  });

  it("weakestCategories orders ascending", () => {
    expect(weakestCategories(mastery, 3)).toEqual(["ALGEBRA", "VOCABULARY", "PROBLEM_SOLVING_DATA_ANALYSIS"]);
  });
});
