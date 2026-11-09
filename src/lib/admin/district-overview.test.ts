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

  it("shows activity counts exactly, as the campus pages and Students lists do (2026-11-09)", () => {
    const o = buildDistrictOverview("Demo ISD", [
      campus({ campusId: "big" }),
      campus({ campusId: "tiny", started: 3, activeThisWeek: 1 }),
    ]);
    expect(o.campuses[1].started).toBe(3);
    expect(o.campuses[1].activeThisWeek).toBe(1);
    expect(o.totals.started).toBe(63);
    expect(o.totals.activeThisWeek).toBe(31);
    expect(o.excluded.started).toBe(0);
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

  it("rolls TSI readiness up from every campus with ten measured, hiding a group only one campus hides", () => {
    const o = buildDistrictOverview("D", [
      campus({ campusId: "a" }), // 8 crossed, 12 held, 0 slipped, 20 below: all shown
      // 3 crossed is "Fewer than 5" on its page (and 10 held is withheld with it).
      campus({ campusId: "b", benchmark: { crossed: 3, held: 10, slipped: 0, below: 12, shortfall: { MISSES_MATH_ONLY: 6, MISSES_READING_ONLY: 6, MISSES_BOTH: 0 } } }),
      // Too few measured: left out, and counted as left out.
      campus({ campusId: "c", benchmark: { crossed: 2, held: 2, slipped: 0, below: 3, shortfall: { MISSES_MATH_ONLY: 3, MISSES_READING_ONLY: 0, MISSES_BOTH: 0 } } }),
      campus({ campusId: "d", benchmark: { crossed: 0, held: 0, slipped: 0, below: 0, shortfall: { MISSES_MATH_ONLY: 0, MISSES_READING_ONLY: 0, MISSES_BOTH: 0 } } }),
    ]);
    // a + b: 65 measured. Only b hides "crossed" and "held", so the district can't show them (it would be
    // the district minus a); slipped and below are shown.
    expect(o.readiness).toMatchObject({ measured: 65, crossed: "withheld", held: "withheld", slipped: 0, below: 32 });
    expect(o.excluded.readiness).toBe(1);
    // b's "meet now" is on its own page already (25 - 12 - 0), so the table shows it.
    expect(o.campuses.map((c) => c.readiness)).toEqual([{ meet: 20, measured: 40 }, { meet: 13, measured: 25 }, null, null]);
  });

  it("shows a group two campuses hide, since the district reveals only their sum", () => {
    const small = { crossed: 2, held: 10, slipped: 0, below: 20, shortfall: { MISSES_MATH_ONLY: 10, MISSES_READING_ONLY: 5, MISSES_BOTH: 5 } };
    const o = buildDistrictOverview("D", [campus({ campusId: "a", benchmark: small }), campus({ campusId: "b", benchmark: small })]);
    expect(o.readiness).toMatchObject({ measured: 64, crossed: null, below: 40 });
    // One district group of 1-4 is hidden, so one more goes with it.
    expect(o.readiness?.held).toBe("withheld");
  });

  it("has no district readiness under ten measured", () => {
    const o = buildDistrictOverview("D", [
      campus({ campusId: "a", benchmark: { crossed: 1, held: 3, slipped: 0, below: 5, shortfall: { MISSES_MATH_ONLY: 5, MISSES_READING_ONLY: 0, MISSES_BOTH: 0 } } }),
    ]);
    expect(o.readiness).toBeNull();
  });

  it("leaves out a campus whose own 'Still below' is hidden, so it can't blank the district", () => {
    const o = buildDistrictOverview("D", [
      campus({ campusId: "a" }),
      // 1 crossed + 3 already met: two small groups adding to 4, so "Still below" is hidden on its page.
      campus({ campusId: "b", benchmark: { crossed: 1, held: 3, slipped: 0, below: 21, shortfall: { MISSES_MATH_ONLY: 8, MISSES_READING_ONLY: 3, MISSES_BOTH: 10 } } }),
    ]);
    expect(o.readiness).toMatchObject({ measured: 40, crossed: 8, held: 12, below: 20, meetNow: 20 });
    expect(o.excluded.readiness).toBe(1);
  });
});
