import { describe, expect, it } from "vitest";
import { buildJourneyNarrative } from "@/lib/progress/journey-narrative";

const base = {
  startingRange: { min: 1260, max: 1320 },
  completedSessions: 43,
  totalQuestionsAnswered: 903,
  totalImprovement: 180,
  greatestImprovement: { category: "GEOMETRY_TRIGONOMETRY" as const, deltaPoints: 19 },
  targetScore: 1500,
  currentRangeMax: 1480,
};

describe("buildJourneyNarrative", () => {
  it("matches the shape of the PRD-008 §7 worked example", () => {
    const narrative = buildJourneyNarrative(base);

    expect(narrative).toContain("You started PrepHub with a predicted SAT score of 1260–1320.");
    expect(narrative).toContain("completed 43 adaptive sessions, answered 903 questions");
    expect(narrative).toContain("improved your predicted SAT score by 180 points");
    expect(narrative).toContain("Your greatest improvement has been Geometry & Trig, increasing by 19%.");
    expect(narrative).toContain("You're now within approximately 20 points of your target score of 1500.");
  });

  it("uses singular 'session' for exactly one completed session", () => {
    const narrative = buildJourneyNarrative({ ...base, completedSessions: 1 });
    expect(narrative).toContain("completed 1 adaptive session,");
  });

  it("omits the session summary sentence when no sessions are completed yet", () => {
    const narrative = buildJourneyNarrative({ ...base, completedSessions: 0, totalQuestionsAnswered: 0, totalImprovement: 0 });
    expect(narrative).not.toContain("Since then");
  });

  it("omits the greatest-improvement sentence when there is no positive delta", () => {
    const narrative = buildJourneyNarrative({ ...base, greatestImprovement: null });
    expect(narrative).not.toContain("greatest improvement");
  });

  it("declares the target reached when the current range already meets or exceeds it", () => {
    const narrative = buildJourneyNarrative({ ...base, currentRangeMax: 1520 });
    expect(narrative).toContain("You've reached your target score of 1500.");
  });

  it("omits target-score language entirely when no target is set", () => {
    const narrative = buildJourneyNarrative({ ...base, targetScore: null });
    expect(narrative).not.toContain("target score");
  });
});
