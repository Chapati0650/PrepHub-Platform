import { describe, expect, it } from "vitest";
import { allShown, combineSkillGaps, protectSkillGaps, type RawSkillGaps } from "./skill-gaps";

const all = (n: number) => ({
  READING_COMPREHENSION: n,
  GRAMMAR: n,
  VOCABULARY: n,
  ALGEBRA: n,
  ADVANCED_MATH: n,
  PROBLEM_SOLVING_DATA_ANALYSIS: n,
  GEOMETRY_TRIGONOMETRY: n,
});

describe("protectSkillGaps", () => {
  it("shows nothing below ten students with a Diagnostic", () => {
    expect(protectSkillGaps({ measured: 9, below: all(5) })).toBeNull();
  });
  it("withholds a count of 1 to 4 and lists the most students below first", () => {
    const g = protectSkillGaps({ measured: 40, below: { ...all(10), ADVANCED_MATH: 30, VOCABULARY: 3, GRAMMAR: 0 } })!;
    expect(g.skills[0].category).toBe("ADVANCED_MATH");
    expect(g.skills.find((s) => s.category === "VOCABULARY")).toMatchObject({ below: null, share: null });
    expect(g.skills.find((s) => s.category === "GRAMMAR")).toMatchObject({ below: 0, share: 0 });
  });
});

describe("combineSkillGaps", () => {
  it("sums only campuses whose every count is shown", () => {
    const a: RawSkillGaps = { measured: 30, below: all(10) };
    const b: RawSkillGaps = { measured: 20, below: { ...all(6), GRAMMAR: 2 } };
    const c: RawSkillGaps = { measured: 4, below: all(1) };
    expect(allShown(a)).toBe(true);
    expect(allShown(b)).toBe(false);
    const { raw, left } = combineSkillGaps([a, b, c]);
    expect(raw.measured).toBe(30);
    expect(raw.below.ALGEBRA).toBe(10);
    expect(left).toBe(2);
  });
});
