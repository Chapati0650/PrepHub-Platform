import { describe, expect, it } from "vitest";
import { domainOf, resolvePartner, type OrganizationShape } from "@/lib/district/partner";

describe("domainOf", () => {
  it("lowercases and strips surrounding whitespace", () => {
    expect(domainOf("  Student@Student.NISDTX.org ")).toBe("student.nisdtx.org");
  });

  it("keeps subdomains intact — districts scope students to one", () => {
    expect(domainOf("a@student.nisdtx.org")).toBe("student.nisdtx.org");
    expect(domainOf("a@nisdtx.org")).toBe("nisdtx.org");
  });

  it.each([
    ["no at sign", "studentnisdtx.org"],
    ["two at signs", "a@b@nisdtx.org"],
    ["nothing before the at", "@nisdtx.org"],
    ["nothing after the at", "student@"],
    ["no dot in the domain", "student@localhost"],
    ["trailing dot", "student@nisdtx."],
    ["leading dot", "student@.nisdtx.org"],
    ["empty", ""],
  ])("rejects %s", (_label, input) => {
    expect(domainOf(input)).toBeNull();
  });
});

const NOW = new Date("2026-10-13T12:00:00Z");

function org(overrides: Partial<OrganizationShape> = {}): OrganizationShape {
  return {
    id: "org1",
    officialName: "Northwest ISD",
    organizationType: "DISTRICT",
    status: "ACTIVE",
    contractStartDate: new Date("2026-08-01T00:00:00Z"),
    contractEndDate: new Date("2027-06-30T00:00:00Z"),
    schools: [],
    ...overrides,
  };
}

describe("resolvePartner", () => {
  it("returns NO_PARTNER when the domain matched nothing", () => {
    expect(resolvePartner(null, NOW)).toEqual({ kind: "NO_PARTNER" });
  });

  it("enrolls into a standalone school as its own campus", () => {
    const o = org({ organizationType: "SCHOOL", id: "s1", officialName: "Byron Nelson High School" });
    expect(resolvePartner(o, NOW)).toEqual({
      kind: "READY",
      organizationId: "s1",
      schoolId: "s1",
      officialName: "Byron Nelson High School",
    });
  });

  it("enrolls into a district's single campus, keeping org and school distinct", () => {
    const o = org({ schools: [{ id: "campus1", officialName: "Northwest High School" }] });
    expect(resolvePartner(o, NOW)).toEqual({
      kind: "READY",
      organizationId: "org1",
      schoolId: "campus1",
      officialName: "Northwest High School",
    });
  });

  it("refuses to guess when a district has several campuses", () => {
    const o = org({
      schools: [
        { id: "campus1", officialName: "Northwest High School" },
        { id: "campus2", officialName: "Byron Nelson High School" },
      ],
    });
    expect(resolvePartner(o, NOW)).toEqual({
      kind: "NEEDS_CAMPUS",
      organizationId: "org1",
      officialName: "Northwest ISD",
    });
  });

  it("refuses a district with no campuses at all rather than inventing one", () => {
    expect(resolvePartner(org({ schools: [] }), NOW).kind).toBe("NEEDS_CAMPUS");
  });

  // A membership that the entitlement service would reject is worse than no
  // membership: the student looks enrolled and still can't open anything.
  it.each([
    ["SETUP", "STATUS"],
    ["SUSPENDED", "STATUS"],
    ["ARCHIVED", "STATUS"],
  ])("will not enroll into a %s organization", (status, reason) => {
    const o = org({ status, organizationType: "SCHOOL" });
    expect(resolvePartner(o, NOW)).toEqual({ kind: "NOT_LIVE", reason });
  });

  it("will not enroll before the contract starts", () => {
    const o = org({ organizationType: "SCHOOL", contractStartDate: new Date("2026-11-01T00:00:00Z") });
    expect(resolvePartner(o, NOW)).toEqual({ kind: "NOT_LIVE", reason: "BEFORE_CONTRACT" });
  });

  it("will not enroll after the contract ends", () => {
    const o = org({ organizationType: "SCHOOL", contractEndDate: new Date("2026-09-30T00:00:00Z") });
    expect(resolvePartner(o, NOW)).toEqual({ kind: "NOT_LIVE", reason: "AFTER_CONTRACT" });
  });

  it("treats the contract end date as exclusive, matching the entitlement service", () => {
    const end = new Date("2026-10-13T12:00:00Z"); // exactly NOW
    const o = org({ organizationType: "SCHOOL", contractEndDate: end });
    expect(resolvePartner(o, NOW)).toEqual({ kind: "NOT_LIVE", reason: "AFTER_CONTRACT" });
  });

  it("allows the first instant of the contract", () => {
    const o = org({ organizationType: "SCHOOL", contractStartDate: NOW });
    expect(resolvePartner(o, NOW).kind).toBe("READY");
  });
});
