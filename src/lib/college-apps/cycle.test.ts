import { describe, it, expect } from "vitest";
import { admissionsCycle, isGrade } from "./cycle";

describe("admissionsCycle", () => {
  it("rolls over on August 1st, when Common App opens", () => {
    expect(admissionsCycle(new Date("2026-07-31T12:00:00Z"))).toBe(2026);
    expect(admissionsCycle(new Date("2026-08-01T00:00:00Z"))).toBe(2027);
    expect(admissionsCycle(new Date("2026-09-19T12:00:00Z"))).toBe(2027);
    expect(admissionsCycle(new Date("2027-03-01T12:00:00Z"))).toBe(2027);
  });
});

describe("isGrade", () => {
  it("accepts 9-12 only", () => {
    expect([9, 10, 11, 12].every(isGrade)).toBe(true);
    expect(isGrade(8)).toBe(false);
    expect(isGrade("11")).toBe(false);
  });
});
