import { describe, it, expect } from "vitest";
import { getCollege, searchColleges, testPolicy } from "./directory";

describe("searchColleges", () => {
  it("finds a college by the start of its name, ranked first", () => {
    const r = searchColleges("rice");
    expect(r[0]?.name).toBe("Rice University");
  });

  it("finds a college by a word inside its name", () => {
    expect(searchColleges("hopkins").some((c) => c.name === "Johns Hopkins University")).toBe(true);
  });

  it("finds a college by alias", () => {
    expect(searchColleges("ucla").some((c) => /Los Angeles/.test(c.name))).toBe(true);
  });

  it("puts both big Michigan schools in the top results, prefix match first", () => {
    const names = searchColleges("michigan", 5).map((c) => c.name);
    expect(names[0]).toBe("Michigan State University"); // name starts with the query
    expect(names.some((n) => /University of Michigan-Ann Arbor/.test(n))).toBe(true);
  });

  it("ignores punctuation and case", () => {
    expect(searchColleges("TEXAS A&M")[0]?.name).toMatch(/Texas A ?& ?M/);
  });

  it("returns nothing for a query under two characters", () => {
    expect(searchColleges("r")).toEqual([]);
    expect(searchColleges("")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(searchColleges("university", 5)).toHaveLength(5);
  });
});

describe("getCollege / testPolicy", () => {
  it("returns Rice by Scorecard id with its SAT range", () => {
    const rice = getCollege(227757);
    expect(rice?.name).toBe("Rice University");
    expect(rice?.sat25).toBe(1510);
    expect(rice?.sat75).toBe(1570);
  });

  it("returns null for an unknown id", () => {
    expect(getCollege(1)).toBeNull();
  });

  it("maps Scorecard's ADMCON7 codes", () => {
    expect(testPolicy({ testRequirements: 1 })).toBe("required");
    expect(testPolicy({ testRequirements: 5 })).toBe("optional");
    expect(testPolicy({ testRequirements: 3 })).toBe("not-considered");
    expect(testPolicy({ testRequirements: null })).toBe("unknown");
  });
});
