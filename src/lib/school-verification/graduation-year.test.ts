import { describe, expect, it } from "vitest";
import { computeExpectedGraduationYear } from "./graduation-year";

describe("computeExpectedGraduationYear", () => {
  it("a senior (grade 12) in the fall semester graduates the following spring", () => {
    const fallDate = new Date(2026, 9, 15); // Oct 15, 2026
    expect(computeExpectedGraduationYear(12, fallDate)).toBe(2027);
  });

  it("a senior (grade 12) in the spring semester graduates that same spring", () => {
    const springDate = new Date(2027, 2, 15); // Mar 15, 2027
    expect(computeExpectedGraduationYear(12, springDate)).toBe(2027);
  });

  it("a freshman (grade 9) graduates three years after the current senior class", () => {
    const fallDate = new Date(2026, 9, 15);
    expect(computeExpectedGraduationYear(9, fallDate)).toBe(2030);
  });

  it.each([
    [9, 4],
    [10, 3],
    [11, 2],
    [12, 1],
  ])("grade %i is %i school year(s) from graduation (fall)", (grade, yearsFromNow) => {
    const fallDate = new Date(2026, 9, 15);
    expect(computeExpectedGraduationYear(grade, fallDate)).toBe(2026 + yearsFromNow);
  });
});
