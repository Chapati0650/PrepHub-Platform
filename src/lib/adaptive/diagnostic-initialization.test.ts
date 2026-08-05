import { describe, expect, it } from "vitest";
import { initialAbilityFromDiagnostic } from "@/lib/adaptive/diagnostic-initialization";

describe("initialAbilityFromDiagnostic", () => {
  it.each([
    [false, false, false, 25.0],
    [true, false, false, 40.0],
    [false, true, false, 45.0],
    [true, true, false, 65.0],
    [false, false, true, 50.0],
    [true, false, true, 75.0],
    [false, true, true, 80.0],
    [true, true, true, 90.0],
  ])("easy=%s medium=%s hard=%s -> %s", (easy, medium, hard, expected) => {
    expect(initialAbilityFromDiagnostic(easy, medium, hard)).toBe(expected);
  });
});
