import { describe, expect, it } from "vitest";
import { resolveDistrictCampus } from "./campus-scope";

const campuses = [
  { id: "c1", name: "North" },
  { id: "c2", name: "South" },
];

describe("resolveDistrictCampus", () => {
  it("returns a campus of the district", () => {
    expect(resolveDistrictCampus(campuses, "c2")).toEqual({ id: "c2", name: "South" });
  });
  it("returns null, never a fallback, for another district's school", () => {
    expect(resolveDistrictCampus(campuses, "other-district-school")).toBeNull();
  });
  it("returns null when nothing is requested", () => {
    expect(resolveDistrictCampus(campuses, undefined)).toBeNull();
    expect(resolveDistrictCampus(campuses, "")).toBeNull();
    expect(resolveDistrictCampus([], "c1")).toBeNull();
  });
});
