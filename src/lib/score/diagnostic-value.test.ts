import { describe, expect, it } from "vitest";
import { diagnosticValueFor } from "@/lib/score/diagnostic-value";

describe("diagnosticValueFor", () => {
  it.each([
    [false, false, false, 400],
    [true, false, false, 1000],
    [false, true, false, 800],
    [true, true, false, 1300],
    [false, false, true, 600],
    [true, false, true, 1200],
    [false, true, true, 1000],
    [true, true, true, 1600],
  ])("easy=%s medium=%s hard=%s -> %s", (easy, medium, hard, expected) => {
    expect(diagnosticValueFor(easy, medium, hard)).toBe(expected);
  });

  it("produces a different value than PRD-014's ability-initialization table for the same pattern (intentional divergence)", () => {
    // PRD-014: E1M0H0 -> ability 40.0. PRD-016: E1M0H0 -> score 1000.
    // Different scales entirely, confirming the tables are truly independent.
    expect(diagnosticValueFor(true, false, false)).toBe(1000);
  });
});
