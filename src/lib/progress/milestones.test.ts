import { describe, expect, it } from "vitest";
import { computeMilestones } from "@/lib/progress/milestones";

describe("computeMilestones", () => {
  it("returns no badges below every threshold", () => {
    const result = computeMilestones({
      totalStudyTimeSeconds: 0,
      totalQuestionsAnswered: 0,
      completedSessions: 0,
      highestPredictedScore: 1000,
    });
    expect(result).toEqual([]);
  });

  it("reports only the highest threshold reached per category, not every one crossed", () => {
    const result = computeMilestones({
      totalStudyTimeSeconds: 50 * 3600, // crosses 1, 5, 10, 25, 50
      totalQuestionsAnswered: 500, // crosses 100, 250, 500
      completedSessions: 25, // crosses 1, 10, 25
      highestPredictedScore: 1350, // crosses 1200, 1300
    });

    expect(result).toEqual(["Fifty Hours Studied", "500 Questions", "Twenty-Five Sessions", "First 1300+"]);
  });

  it("uses singular phrasing for the first session and first hour", () => {
    const result = computeMilestones({
      totalStudyTimeSeconds: 3600,
      totalQuestionsAnswered: 0,
      completedSessions: 1,
      highestPredictedScore: 900,
    });

    expect(result).toContain("First Hour Studied");
    expect(result).toContain("First Session");
  });

  it("reaches the top score milestone at 1550", () => {
    const result = computeMilestones({
      totalStudyTimeSeconds: 0,
      totalQuestionsAnswered: 0,
      completedSessions: 0,
      highestPredictedScore: 1580,
    });

    expect(result).toContain("First 1550+");
  });
});
