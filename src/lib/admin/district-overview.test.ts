import { describe, expect, it } from "vitest";
import { buildDistrictOverview, type RawCampusFigures } from "./district-overview";

function campus(over: Partial<RawCampusFigures> & { campusId: string }): RawCampusFigures {
  return {
    campusName: over.campusId,
    registered: 100,
    active: 90,
    started: 60,
    activeThisWeek: 30,
    questionsAnswered: 5000,
    practiceSetsFinished: 200,
    measurableStudents: 40,
    totalScoreGain: 40 * 25,
    benchmark: { crossed: 8, held: 12, slipped: 0, below: 20, shortfall: { MISSES_MATH_ONLY: 10, MISSES_READING_ONLY: 5, MISSES_BOTH: 5 } },
    ...over,
  };
}

describe("buildDistrictOverview", () => {
  it("sums the campuses for the district and keeps one row per campus", () => {
    const o = buildDistrictOverview("Demo ISD", [
      campus({ campusId: "a" }),
      campus({
        campusId: "b",
        registered: 50,
        started: 20,
        activeThisWeek: 10,
        questionsAnswered: 1000,
        practiceSetsFinished: 30,
        measurableStudents: 10,
        totalScoreGain: 10 * 45,
      }),
    ]);
    expect(o.campuses.map((c) => c.campusId)).toEqual(["a", "b"]);
    expect(o.totals).toMatchObject({
      registered: 150,
      started: 80,
      activeThisWeek: 40,
      questionsAnswered: 6000,
      practiceSetsFinished: 230,
      measurableStudents: 50,
    });
    // Weighted by students: (1000 + 450) / 50.
    expect(o.totals.averageScoreGain).toBe(29);
    expect(o.campuses[1].averageScoreGain).toBe(45);
  });

  it("withholds a campus's small groups, but still counts them in the district", () => {
    const o = buildDistrictOverview("Demo ISD", [
      campus({ campusId: "big" }),
      campus({ campusId: "tiny", started: 3, activeThisWeek: 1 }),
    ]);
    expect(o.campuses[1].started).toBeNull();
    expect(o.campuses[1].activeThisWeek).toBeNull();
    expect(o.campuses[0].started).toBe(60);
    // The district figure leaves the withheld campus out entirely.
    expect(o.totals.started).toBe(60);
    expect(o.excluded.started).toBe(1);
  });

  it("does not let a withheld value be recovered from the totals", () => {
    const visible = campus({ campusId: "big", started: 60, activeThisWeek: 30 });
    const a = buildDistrictOverview("D", [visible, campus({ campusId: "hidden", started: 3, activeThisWeek: 2 })]);
    const b = buildDistrictOverview("D", [visible, campus({ campusId: "hidden", started: 4, activeThisWeek: 1 })]);
    // Different hidden values, identical district figures: nothing to subtract.
    expect(a.totals).toEqual(b.totals);
  });

  it("shows zero as zero, and withholds a district group of fewer than five", () => {
    const zero = buildDistrictOverview("D", [campus({ campusId: "a", started: 0, activeThisWeek: 0 })]);
    expect(zero.totals.started).toBe(0);
    expect(zero.campuses[0].started).toBe(0);
    const few = buildDistrictOverview("D", [
      campus({ campusId: "a", started: 2, activeThisWeek: 2 }),
      campus({ campusId: "b", started: 1, activeThisWeek: 1 }),
    ]);
    expect(few.totals.started).toBe(0);
    expect(few.excluded.started).toBe(2);
    // Two visible campuses of 2 and 3 are each shown only if 0 or 5+; a district of visible campuses summing under five is withheld.
    const under = buildDistrictOverview("D", [campus({ campusId: "a", started: 0 }), campus({ campusId: "b", started: 0 })]);
    expect(under.totals.started).toBe(0);
    // Exactly five is shown.
    const five = buildDistrictOverview("D", [campus({ campusId: "a", started: 5 })]);
    expect(five.campuses[0].started).toBe(5);
  });

  it("shows score growth only for 10 or more measurable students, per campus and for the district", () => {
    const o = buildDistrictOverview("D", [
      campus({ campusId: "a", measurableStudents: 6, totalScoreGain: 6 * 30 }),
      campus({ campusId: "b", measurableStudents: 5, totalScoreGain: 5 * 30 }),
    ]);
    expect(o.campuses[0].averageScoreGain).toBeNull();
    expect(o.campuses[1].averageScoreGain).toBeNull();
    expect(o.totals.averageScoreGain).toBeNull(); // neither campus is shown, so neither is in the district figure
    expect(o.excluded.scoreGain).toBe(2);
    const small = buildDistrictOverview("D", [campus({ campusId: "a", measurableStudents: 9, totalScoreGain: 90 })]);
    expect(small.totals.averageScoreGain).toBeNull();
    const mixed = buildDistrictOverview("D", [
      campus({ campusId: "a", measurableStudents: 10, totalScoreGain: 100 }),
      campus({ campusId: "b", measurableStudents: 9, totalScoreGain: 900 }),
    ]);
    expect(mixed.totals.averageScoreGain).toBe(10);
    expect(mixed.totals.measurableStudents).toBe(10);
    const exactly = buildDistrictOverview("D", [campus({ campusId: "a", measurableStudents: 10, totalScoreGain: 100 })]);
    expect(exactly.totals.averageScoreGain).toBe(10);
  });

  it("handles a district with no campuses", () => {
    const o = buildDistrictOverview("D", []);
    expect(o.campuses).toEqual([]);
    expect(o.totals).toMatchObject({ registered: 0, started: 0, averageScoreGain: null });
  });

  it("rolls TSI readiness up from whole campuses only, so a withheld group can't be subtracted out", () => {
    const o = buildDistrictOverview("D", [
      campus({ campusId: "a" }),
      // 3 crossed is withheld on its campus page, so the whole campus stays out of the district figure.
      campus({ campusId: "b", benchmark: { crossed: 3, held: 10, slipped: 0, below: 12, shortfall: { MISSES_MATH_ONLY: 6, MISSES_READING_ONLY: 6, MISSES_BOTH: 0 } } }),
      // Too few measured to show at all.
      campus({ campusId: "c", benchmark: { crossed: 2, held: 2, slipped: 0, below: 3, shortfall: { MISSES_MATH_ONLY: 3, MISSES_READING_ONLY: 0, MISSES_BOTH: 0 } } }),
      campus({ campusId: "d", benchmark: { crossed: 0, held: 0, slipped: 0, below: 0, shortfall: { MISSES_MATH_ONLY: 0, MISSES_READING_ONLY: 0, MISSES_BOTH: 0 } } }),
    ]);
    expect(o.readiness).toMatchObject({ measured: 40, crossed: 8, held: 12, below: 20, slipped: 0 });
    expect(o.excluded.readiness).toBe(2); // b and c; d has nobody measured
    expect(o.campuses.map((c) => c.readiness)).toEqual([{ meet: 20, measured: 40 }, null, null, null]);
  });

  it("has no district readiness until a whole campus can be shown", () => {
    const o = buildDistrictOverview("D", [
      campus({ campusId: "a", benchmark: { crossed: 1, held: 9, slipped: 0, below: 10, shortfall: { MISSES_MATH_ONLY: 5, MISSES_READING_ONLY: 5, MISSES_BOTH: 0 } } }),
    ]);
    expect(o.readiness).toBeNull();
  });
});
