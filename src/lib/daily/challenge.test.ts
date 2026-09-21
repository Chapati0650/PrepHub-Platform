import { describe, it, expect } from "vitest";
import { dayKey, streakFromDays } from "./challenge";

describe("dayKey", () => {
  it("is the UTC calendar day", () => {
    expect(dayKey(new Date("2026-09-21T23:59:59Z"))).toBe("2026-09-21");
    expect(dayKey(new Date("2026-09-22T00:00:01Z"))).toBe("2026-09-22");
  });
});

describe("streakFromDays", () => {
  it("counts consecutive days ending today", () => {
    expect(streakFromDays(new Set(["2026-09-19", "2026-09-20", "2026-09-21"]), "2026-09-21")).toBe(3);
  });

  it("isn't broken by a day that hasn't been answered yet", () => {
    expect(streakFromDays(new Set(["2026-09-19", "2026-09-20"]), "2026-09-21")).toBe(2);
  });

  it("breaks on a gap", () => {
    expect(streakFromDays(new Set(["2026-09-17", "2026-09-18", "2026-09-20", "2026-09-21"]), "2026-09-21")).toBe(2);
  });

  it("is zero with nothing recent", () => {
    expect(streakFromDays(new Set(["2026-09-01"]), "2026-09-21")).toBe(0);
    expect(streakFromDays(new Set(), "2026-09-21")).toBe(0);
  });

  it("crosses a month boundary", () => {
    expect(streakFromDays(new Set(["2026-08-31", "2026-09-01"]), "2026-09-01")).toBe(2);
  });
});
