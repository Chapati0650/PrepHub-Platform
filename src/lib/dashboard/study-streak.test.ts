import { describe, expect, it } from "vitest";
import { computeStudyStreak, streakFromDays } from "@/lib/dashboard/study-streak";

describe("streakFromDays", () => {
  it("counts consecutive days ending today", () => {
    expect(streakFromDays(new Set(["2026-09-19", "2026-09-20", "2026-09-21"]), "2026-09-21")).toBe(3);
  });

  it("isn't broken by a day that hasn't been studied yet", () => {
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

  it("crosses a year boundary", () => {
    expect(streakFromDays(new Set(["2026-12-31", "2027-01-01"]), "2027-01-01")).toBe(2);
  });

  // Calendar days, not 24-hour steps: the night the clocks go back in Texas
  // (2026-11-01) is a 25-hour day, and it still counts as exactly one.
  it("crosses a daylight-saving change", () => {
    expect(streakFromDays(new Set(["2026-10-31", "2026-11-01", "2026-11-02"]), "2026-11-02")).toBe(3);
    expect(streakFromDays(new Set(["2026-03-07", "2026-03-08", "2026-03-09"]), "2026-03-09")).toBe(3);
  });
});

describe("computeStudyStreak", () => {
  const NOW = new Date("2026-08-04T15:00:00Z");
  function daysAgo(n: number): Date {
    return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
  }

  it("returns 0 with no activity", () => {
    expect(computeStudyStreak([], NOW)).toBe(0);
  });

  it("counts today as day 1 when there's already activity today", () => {
    expect(computeStudyStreak([daysAgo(0)], NOW)).toBe(1);
  });

  it("does not break the streak just because today has no activity yet", () => {
    expect(computeStudyStreak([daysAgo(1), daysAgo(2)], NOW)).toBe(2);
  });

  it("breaks the streak on the first gap day", () => {
    expect(computeStudyStreak([daysAgo(0), daysAgo(1), daysAgo(3)], NOW)).toBe(2);
  });

  it("counts multiple activities on the same day only once", () => {
    const today = daysAgo(0);
    const alsoToday = new Date(today.getTime() + 60 * 60 * 1000);
    expect(computeStudyStreak([today, alsoToday], NOW)).toBe(1);
  });

  it("counts a long unbroken streak correctly", () => {
    const dates = Array.from({ length: 12 }, (_, i) => daysAgo(i));
    expect(computeStudyStreak(dates, NOW)).toBe(12);
  });

  it("is 0 when the most recent activity was two or more days ago", () => {
    expect(computeStudyStreak([daysAgo(2)], NOW)).toBe(0);
  });

  // Its caller hands it one midnight-UTC timestamp per UTC day, so it keys in
  // UTC whatever zone the machine runs in. Keyed in Central, these two would
  // both be August 3rd.
  it("keys days in UTC, not in the server's zone", () => {
    const lateOnTheThird = new Date("2026-08-03T23:00:00Z");
    const earlyOnTheFourth = new Date("2026-08-04T01:00:00Z");
    expect(computeStudyStreak([lateOnTheThird, earlyOnTheFourth], new Date("2026-08-04T12:00:00Z"))).toBe(2);
  });
});
