import { describe, expect, it } from "vitest";
import { computeSchoolMilestones } from "@/lib/community/milestones";

describe("computeSchoolMilestones", () => {
  it("returns no badges below every threshold", () => {
    const result = computeSchoolMilestones({
      totalQuestionsAnswered: 0,
      totalStudyHours: 0,
      totalAdaptiveSessionsCompleted: 0,
      totalEstimatedSatPointsImproved: 0,
    });
    expect(result).toEqual([]);
  });

  it("reports only the highest threshold reached per category", () => {
    const result = computeSchoolMilestones({
      totalQuestionsAnswered: 62_000, // crosses 10k, 50k
      totalStudyHours: 500, // crosses 100, 500
      totalAdaptiveSessionsCompleted: 1200, // crosses 1000
      totalEstimatedSatPointsImproved: 10_500, // crosses all three
    });

    expect(result).toEqual([
      "50,000 Questions",
      "500 Hours",
      "1,000 Sessions",
      "10,000 Total Estimated SAT Points",
    ]);
  });

  it("reaches the top milestone in every category", () => {
    const result = computeSchoolMilestones({
      totalQuestionsAnswered: 150_000,
      totalStudyHours: 1500,
      totalAdaptiveSessionsCompleted: 15_000,
      totalEstimatedSatPointsImproved: 15_000,
    });

    expect(result).toEqual([
      "100,000 Questions",
      "1,000 Hours",
      "10,000 Sessions",
      "10,000 Total Estimated SAT Points",
    ]);
  });
});
