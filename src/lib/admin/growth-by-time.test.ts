import { describe, expect, it } from "vitest";
import { bandLabel, mergeBands } from "./growth-by-time";

const EDGES = [0, 1, 2, 4] as const;
const band = (b: number, students: number, avg: number) => ({ band: b, students, totalGain: students * avg });

describe("mergeBands", () => {
  it("keeps bands that are already big enough", () => {
    const g = mergeBands([band(0, 10, 5), band(1, 12, 20), band(2, 15, 30), band(3, 11, 60)], EDGES, 10);
    expect(g?.bands.map((b) => [b.fromHours, b.toHours, b.students, b.averageGain])).toEqual([
      [0, 1, 10, 5],
      [1, 2, 12, 20],
      [2, 4, 15, 30],
      [4, null, 11, 60],
    ]);
    expect(g?.measured).toBe(48);
  });

  it("folds a small band into the one above, weighting the average by students", () => {
    const g = mergeBands([band(0, 4, 0), band(1, 8, 30), band(2, 20, 40), band(3, 10, 50)], EDGES, 10);
    expect(g?.bands.map((b) => [b.fromHours, b.toHours, b.students, b.averageGain])).toEqual([
      [0, 2, 12, 20],
      [2, 4, 20, 40],
      [4, null, 10, 50],
    ]);
  });

  it("folds a small top band into the one below", () => {
    const g = mergeBands([band(0, 15, 10), band(1, 15, 20), band(3, 3, 90)], EDGES, 10);
    expect(g?.bands.map((b) => [b.fromHours, b.toHours, b.students])).toEqual([
      [0, 1, 15],
      [1, null, 18],
    ]);
  });

  it("never withholds anyone: every measurable student is in a shown band", () => {
    const raw = [band(0, 1, -40), band(1, 9, 10), band(2, 2, 200), band(3, 30, 25)];
    const g = mergeBands(raw, EDGES, 10)!;
    expect(g.bands.reduce((n, b) => n + b.students, 0)).toBe(42);
    expect(g.bands.every((b) => b.students >= 10)).toBe(true);
  });

  it("is null below two bands' worth of students, or when only one band survives", () => {
    expect(mergeBands([band(0, 19, 10)], EDGES, 10)).toBeNull();
    expect(mergeBands([band(0, 4, 10), band(1, 4, 10), band(2, 4, 10), band(3, 9, 10)], EDGES, 10)).toBeNull();
    expect(mergeBands([], EDGES, 10)).toBeNull();
  });
});

describe("bandLabel", () => {
  it("reads naturally", () => {
    expect(bandLabel({ fromHours: 0, toHours: 1 })).toBe("Under 1 hour");
    expect(bandLabel({ fromHours: 0, toHours: 4 })).toBe("Under 4 hours");
    expect(bandLabel({ fromHours: 2, toHours: 4 })).toBe("2–4 hours");
    expect(bandLabel({ fromHours: 20, toHours: null })).toBe("20+ hours");
  });
});
