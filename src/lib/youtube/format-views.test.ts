import { describe, it, expect } from "vitest";
import { formatViewCount } from "./format-views";

describe("formatViewCount", () => {
  it.each([
    [0, "0"],
    [980, "980"],
    [999, "999"],
    [1_000, "1K"],
    [1_499, "1.4K"],
    [9_950, "9.9K"],
    [10_000, "10K"],
    [45_300, "45K"],
    [999_999, "999K"],
    [1_000_000, "1M"],
    [1_234_567, "1.2M"],
    [8_300_000, "8.3M"],
    [12_345_678, "12M"],
    [1_500_000_000, "1.5B"],
  ])("formats %i as %s", (input, expected) => {
    expect(formatViewCount(input)).toBe(expected);
  });

  it("floors rather than rounds, so it never overstates", () => {
    expect(formatViewCount(1_299_999)).toBe("1.2M");
    expect(formatViewCount(9_999)).toBe("9.9K");
  });

  it("is defensive about bad input", () => {
    expect(formatViewCount(-5)).toBe("0");
    expect(formatViewCount(Number.NaN)).toBe("0");
  });
});
