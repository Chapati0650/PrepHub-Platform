import { describe, expect, it } from "vitest";
import { computeExpectedGraduationYear, gradeFromGraduationYear } from "./graduation-year";

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

describe("gradeFromGraduationYear", () => {
  const fall = new Date("2026-10-13T00:00:00Z");   // 2026-2027 school year
  const spring = new Date("2027-03-01T00:00:00Z"); // same school year

  it("round-trips with computeExpectedGraduationYear", () => {
    for (const grade of [9, 10, 11, 12]) {
      expect(gradeFromGraduationYear(computeExpectedGraduationYear(grade, fall), fall)).toBe(grade);
      expect(gradeFromGraduationYear(computeExpectedGraduationYear(grade, spring), spring)).toBe(grade);
    }
  });

  it("reads a senior's graduation year in the fall semester", () => {
    expect(gradeFromGraduationYear(2027, fall)).toBe(12);
  });

  // Bad roster data must not be turned into a confident wrong answer.
  it.each([
    ["already graduated", 2020],
    ["too far out to be high school", 2040],
    ["not an integer", 2027.5],
  ])("returns null for %s", (_label, year) => {
    expect(gradeFromGraduationYear(year, fall)).toBeNull();
  });

  it("returns null when the roster supplied nothing", () => {
    expect(gradeFromGraduationYear(null, fall)).toBeNull();
  });
});
