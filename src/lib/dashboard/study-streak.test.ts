import { describe, expect, it } from "vitest";
import { computeStudyStreak } from "@/lib/dashboard/study-streak";

const NOW = new Date("2026-08-04T15:00:00Z");
function daysAgo(n: number): Date {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d;
}

describe("computeStudyStreak", () => {
  it("returns 0 with no activity", () => {
    expect(computeStudyStreak([], NOW)).toBe(0);
  });

  it("counts today as day 1 when the student has already studied today", () => {
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
});
