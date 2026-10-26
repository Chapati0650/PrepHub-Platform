import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatContractDate, getSchoolAccessInfo, schoolAccessState } from "@/lib/admin/access-info";
import { hasActiveSchoolEntitlement, type MembershipRow } from "@/lib/entitlements";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: { organization: { findUniqueOrThrow: vi.fn() } },
}));

const mocked = prisma as unknown as { organization: { findUniqueOrThrow: ReturnType<typeof vi.fn> } };

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSchoolAccessInfo", () => {
  it("returns status and contract dates without any billing/contract-management detail", async () => {
    const now = new Date("2026-10-26T12:00:00Z");
    mocked.organization.findUniqueOrThrow.mockResolvedValue({
      officialName: "Lebanon Trail High School",
      status: "ACTIVE",
      contractStartDate: new Date("2026-08-01"),
      contractEndDate: new Date("2027-05-31"),
      parentDistrict: null,
      internalNotes: "confidential pricing notes",
    });

    const result = await getSchoolAccessInfo("school1", now);

    expect(result).toEqual({
      schoolName: "Lebanon Trail High School",
      providedBy: null,
      state: "ACTIVE",
      contractStartDate: new Date("2026-08-01"),
      contractEndDate: new Date("2027-05-31"),
    });
    expect(JSON.stringify(result)).not.toContain("confidential");
  });

  it("reads a district campus's access from the district, which is what decides Premium", async () => {
    const now = new Date("2026-10-26T12:00:00Z");
    // The campus row still holds what was copied when it was added: SETUP,
    // and last year's dates. The district was activated and renewed since.
    mocked.organization.findUniqueOrThrow.mockResolvedValue({
      officialName: "Aledo High School",
      status: "SETUP",
      contractStartDate: new Date("2025-08-01"),
      contractEndDate: new Date("2026-05-31"),
      parentDistrict: {
        officialName: "Aledo ISD",
        status: "ACTIVE",
        contractStartDate: new Date("2026-08-01"),
        contractEndDate: new Date("2027-05-31"),
      },
    });

    const result = await getSchoolAccessInfo("campus1", now);

    expect(result).toMatchObject({
      schoolName: "Aledo High School",
      providedBy: "Aledo ISD",
      state: "ACTIVE",
      contractEndDate: new Date("2027-05-31"),
    });
  });
});

describe("schoolAccessState", () => {
  const NOW = new Date("2026-10-26T12:00:00Z");
  const contract = (status: string, startOffsetDays: number, endOffsetDays: number) => ({
    status: status as "ACTIVE",
    contractStartDate: new Date(NOW.getTime() + startOffsetDays * DAY),
    contractEndDate: new Date(NOW.getTime() + endOffsetDays * DAY),
  });

  it("says Ended once the end date has passed, even while the status still says ACTIVE", () => {
    expect(schoolAccessState(contract("ACTIVE", -300, -1), NOW)).toBe("ENDED");
    expect(schoolAccessState(contract("EXPIRED", -300, 30), NOW)).toBe("ENDED");
  });

  it("separates not started, paused and closed", () => {
    expect(schoolAccessState(contract("SETUP", -10, 300), NOW)).toBe("NOT_STARTED");
    expect(schoolAccessState(contract("ACTIVE", 10, 300), NOW)).toBe("NOT_STARTED");
    expect(schoolAccessState(contract("SUSPENDED", -10, 300), NOW)).toBe("PAUSED");
    expect(schoolAccessState(contract("ARCHIVED", -10, 300), NOW)).toBe("CLOSED");
    expect(schoolAccessState(contract("ACTIVE", -10, 300), NOW)).toBe("ACTIVE");
  });

  it("is ACTIVE exactly when the entitlement service grants an enrolled student Premium", () => {
    // hasActiveSchoolEntitlement reads the real clock, so this one does too.
    const now = new Date();
    const offsets = [-400, -1, 1, 400];
    for (const status of ["SETUP", "ACTIVE", "EXPIRED", "SUSPENDED", "ARCHIVED"] as const) {
      for (const start of offsets) {
        for (const end of offsets) {
          if (end <= start) continue;
          const organization = {
            status,
            contractStartDate: new Date(now.getTime() + start * DAY),
            contractEndDate: new Date(now.getTime() + end * DAY),
          };
          const membership = {
            status: "ACTIVE",
            expectedGraduationYear: now.getUTCFullYear() + 3,
            organization,
          } as unknown as MembershipRow;
          expect(schoolAccessState(organization, now) === "ACTIVE").toBe(hasActiveSchoolEntitlement(membership));
        }
      }
    }
  });
});

describe("formatContractDate", () => {
  it("shows the day the Owner typed, not the evening before in Central time", () => {
    expect(formatContractDate(new Date("2027-05-31"))).toBe("May 31, 2027");
    expect(formatContractDate(new Date("2027-05-31"), "month")).toBe("May 2027");
  });
});
