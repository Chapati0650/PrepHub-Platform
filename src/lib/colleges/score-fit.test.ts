import { describe, it, expect } from "vitest";
import { scoreFit } from "./score-fit";

const rice = { sat25: 1510, sat75: 1570 };

describe("scoreFit", () => {
  it("is 'likely' when the student's whole range is at or above the 75th percentile", () => {
    expect(scoreFit({ min: 1570, max: 1600 }, rice)).toEqual({ fit: "likely", aimFor: 1570, gap: 0 });
  });

  it("is 'target' when the ranges overlap", () => {
    expect(scoreFit({ min: 1490, max: 1550 }, rice).fit).toBe("target");
    expect(scoreFit({ min: 1530, max: 1590 }, rice).fit).toBe("target");
  });

  it("is 'reach' when the student's whole range is below the 25th percentile", () => {
    const r = scoreFit({ min: 1290, max: 1360 }, rice);
    expect(r.fit).toBe("reach");
    expect(r.aimFor).toBe(1570);
    expect(r.gap).toBe(210);
  });

  it("measures the gap from the student's upper bound, never negative", () => {
    expect(scoreFit({ min: 1500, max: 1560 }, rice).gap).toBe(10);
    expect(scoreFit({ min: 1580, max: 1600 }, rice).gap).toBe(0);
  });

  it("is 'unknown' with no college data, and still names nothing to aim for", () => {
    expect(scoreFit({ min: 1400, max: 1470 }, { sat25: null, sat75: null })).toEqual({ fit: "unknown", aimFor: null, gap: null });
  });

  it("is 'unknown' with no student prediction, but still says what to aim for", () => {
    expect(scoreFit(null, rice)).toEqual({ fit: "unknown", aimFor: 1570, gap: null });
  });

  it("treats a boundary exactly on the 25th percentile as target, not reach", () => {
    expect(scoreFit({ min: 1450, max: 1510 }, rice).fit).toBe("target");
  });
});
