import { describe, expect, it } from "vitest";
import { alongPath, LabelPlacer, spotToward, textBox } from "./label-place";
import { labelRuns, labelWidth } from "./svg-label";

describe("placing labels", () => {
  it("takes the first spot when it's clear, and moves off a blocked one", () => {
    const placer = new LabelPlacer({ x0: 0, y0: 0, x1: 200, y1: 200 });
    const spots = [spotToward([100, 100], [1, -1], 9, 15), spotToward([100, 100], [-1, -1], 9, 15)];
    expect(placer.place(spots, 30, 15)).toEqual(spots[0]);
    // The first label now blocks that spot, so a second label there moves.
    expect(placer.place(spots, 30, 15)).toEqual(spots[1]);
  });

  it("keeps a label off a drawn line and inside the figure", () => {
    const placer = new LabelPlacer({ x0: 0, y0: 0, x1: 200, y1: 200 });
    placer.blockPath([
      [0, 80],
      [200, 80],
    ]);
    const across = { x: 100, y: 85, anchor: "middle" as const };
    const outside = { x: 100, y: -20, anchor: "middle" as const };
    const above = { x: 100, y: 60, anchor: "middle" as const };
    expect(placer.place([across, outside, above], 40, 15)).toEqual(above);
  });

  it("measures text boxes by anchor and finds points along a path", () => {
    expect(textBox({ x: 50, y: 20, anchor: "end" }, 30, 10)).toEqual({ x0: 20, x1: 50, y0: 12, y1: 22.4 });
    expect(
      alongPath(
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        0.75,
      ),
    ).toEqual({ at: [10, 5], dir: [0, 10] });
  });
});

describe("figure label type", () => {
  it("sets a fraction as a case fraction, and estimates width", () => {
    expect(labelRuns("$p = \\frac{3}{4}t$").map((r) => [r.text, r.shift ?? null])).toEqual([
      ["p", null],
      [" = ", null],
      ["3", "sup"],
      ["⁄", null],
      ["4", "sub"],
      ["t", null],
    ]);
    expect(labelWidth("2000", 13)).toBeGreaterThan(labelWidth("8", 13) * 3);
  });
});
