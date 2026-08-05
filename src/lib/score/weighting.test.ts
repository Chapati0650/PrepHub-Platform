import { describe, expect, it } from "vitest";
import { mathValue, overallValue, readingWritingValue } from "@/lib/score/weighting";

describe("readingWritingValue", () => {
  it("weights Reading 45%, Grammar 45%, Vocabulary 10%", () => {
    expect(readingWritingValue(100, 0, 0)).toBeCloseTo(45, 6);
    expect(readingWritingValue(0, 100, 0)).toBeCloseTo(45, 6);
    expect(readingWritingValue(0, 0, 100)).toBeCloseTo(10, 6);
    expect(readingWritingValue(50, 50, 50)).toBeCloseTo(50, 6);
  });
});

describe("mathValue", () => {
  it("weights Algebra 35%, Advanced Math 35%, Problem Solving 15%, Geometry & Trig 15%", () => {
    expect(mathValue(100, 0, 0, 0)).toBeCloseTo(35, 6);
    expect(mathValue(0, 100, 0, 0)).toBeCloseTo(35, 6);
    expect(mathValue(0, 0, 100, 0)).toBeCloseTo(15, 6);
    expect(mathValue(0, 0, 0, 100)).toBeCloseTo(15, 6);
    expect(mathValue(50, 50, 50, 50)).toBeCloseTo(50, 6);
  });
});

describe("overallValue", () => {
  it("averages Reading/Writing and Math", () => {
    expect(overallValue(80, 40)).toBeCloseTo(60, 6);
    expect(overallValue(0, 0)).toBe(0);
    expect(overallValue(100, 100)).toBe(100);
  });
});
