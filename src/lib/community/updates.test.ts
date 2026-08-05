import { describe, expect, it } from "vitest";
import { buildCommunityUpdates } from "@/lib/community/updates";

const base = {
  schoolName: "Lebanon Trail",
  questionsAnsweredToday: 0,
  studentsActiveToday: 0,
  weeklyEstimatedSatPointsImproved: 0,
  weeklyStudyHours: 0,
};

describe("buildCommunityUpdates", () => {
  it("produces no updates when nothing happened", () => {
    expect(buildCommunityUpdates(base)).toEqual([]);
  });

  it("never includes a student name or id — only the aggregate numbers passed in", () => {
    const updates = buildCommunityUpdates({ ...base, questionsAnsweredToday: 2814, studentsActiveToday: 31 });
    for (const update of updates) {
      expect(update).not.toMatch(/student_|user_|@/);
    }
  });

  it("includes the questions-answered-today update with the school name", () => {
    const updates = buildCommunityUpdates({ ...base, questionsAnsweredToday: 2814 });
    expect(updates).toContain("Lebanon Trail students answered 2,814 questions today.");
  });

  it("uses singular phrasing for exactly one active student", () => {
    const updates = buildCommunityUpdates({ ...base, studentsActiveToday: 1 });
    expect(updates).toContain("1 student completed an adaptive session today.");
  });

  it("uses plural phrasing for multiple active students", () => {
    const updates = buildCommunityUpdates({ ...base, studentsActiveToday: 31 });
    expect(updates).toContain("31 students completed an adaptive session today.");
  });

  it("includes the weekly SAT improvement update only when positive", () => {
    expect(buildCommunityUpdates({ ...base, weeklyEstimatedSatPointsImproved: 420 })).toContain(
      "Lebanon Trail improved by an estimated 420 SAT points this week.",
    );
    expect(buildCommunityUpdates({ ...base, weeklyEstimatedSatPointsImproved: 0 })).toEqual([]);
  });

  it("can include multiple updates at once", () => {
    const updates = buildCommunityUpdates({
      schoolName: "Lebanon Trail",
      questionsAnsweredToday: 100,
      studentsActiveToday: 5,
      weeklyEstimatedSatPointsImproved: 200,
      weeklyStudyHours: 50,
    });
    expect(updates).toHaveLength(4);
  });
});
