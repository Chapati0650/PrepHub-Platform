import { describe, expect, it } from "vitest";
import { getRecommendedPace, STUDY_COMMITMENT_OPTIONS } from "@/lib/onboarding/study-commitment";

describe("getRecommendedPace", () => {
  it("returns a non-empty recommendation for every study commitment option", () => {
    for (const option of STUDY_COMMITMENT_OPTIONS) {
      const pace = getRecommendedPace(option.value);
      expect(pace.label.length).toBeGreaterThan(0);
    }
  });

  it("recommends half a set per day for LIGHT commitment", () => {
    expect(getRecommendedPace("LIGHT").label).toBe("Complete ½ a set per day");
  });

  it("recommends one set per day for MODERATE commitment", () => {
    expect(getRecommendedPace("MODERATE").label).toBe("Complete 1 set per day");
  });

  it("recommends two sets per day for INTENSIVE commitment", () => {
    expect(getRecommendedPace("INTENSIVE").label).toBe("Complete 2 sets per day");
  });

  it("recommends one set per practice day for FEW_TIMES_WEEK commitment", () => {
    expect(getRecommendedPace("FEW_TIMES_WEEK").label).toBe("Complete 1 set on practice days");
  });

  it("recommends a conservative starting pace for UNSURE commitment", () => {
    expect(getRecommendedPace("UNSURE").label).toBe("Start with ½ a set per day");
  });
});
