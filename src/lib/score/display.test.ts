import { describe, expect, it } from "vitest";
import { predictionCenter, predictionText, predictionView, hasPointEstimate } from "@/lib/score/display";
import { SCORING_ENGINE_VERSION } from "@/lib/score/config";

const entry = (scoringEngineVersion: string) => ({
  scoringEngineVersion,
  displayedRangeMinimum: 1190,
  displayedRangeMaximum: 1290,
  representativeMidpoint: 1240,
});

describe("prediction display", () => {
  it("reads the current version as a score with a likely band", () => {
    const view = predictionView(entry(SCORING_ENGINE_VERSION));
    expect(view).toEqual({ min: 1190, max: 1290, point: 1240 });
    expect(predictionText(view)).toBe("1240 (likely 1190–1290)");
    expect(predictionCenter(view)).toBe(1240);
  });

  it("reads 2026.2 and 2026.1 entries as the range they stored, never as a point", () => {
    for (const version of ["2026.2", "2026.1"]) {
      const view = predictionView({ ...entry(version), displayedRangeMinimum: 1130, displayedRangeMaximum: 1200, representativeMidpoint: 1165 });
      expect(view.point).toBeNull();
      expect(predictionText(view)).toBe("1130–1200");
      expect(predictionCenter(view)).toBe(1165);
    }
  });

  it("knows which versions store a point", () => {
    expect(hasPointEstimate("2026.3")).toBe(true);
    expect(hasPointEstimate("2026.2")).toBe(false);
    expect(hasPointEstimate("nonsense")).toBe(false);
  });
});
