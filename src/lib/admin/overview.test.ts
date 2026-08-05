import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAdminOverviewData } from "@/lib/admin/overview";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    organization: { findUniqueOrThrow: vi.fn() },
    studentMembership: { findMany: vi.fn(), count: vi.fn() },
    finalizedAttempt: { findMany: vi.fn() },
    diagnosticAttempt: { findMany: vi.fn() },
    practiceSet: { findMany: vi.fn() },
    diagnosticSession: { findMany: vi.fn() },
    predictionHistoryEntry: { findMany: vi.fn() },
  };
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as {
  organization: Record<string, ReturnType<typeof vi.fn>>;
  studentMembership: Record<string, ReturnType<typeof vi.fn>>;
  finalizedAttempt: Record<string, ReturnType<typeof vi.fn>>;
  diagnosticAttempt: Record<string, ReturnType<typeof vi.fn>>;
  practiceSet: Record<string, ReturnType<typeof vi.fn>>;
  diagnosticSession: Record<string, ReturnType<typeof vi.fn>>;
  predictionHistoryEntry: Record<string, ReturnType<typeof vi.fn>>;
};

function org(overrides: Partial<{ totalEnrollment: number | null; status: string }> = {}) {
  return {
    officialName: "Lebanon Trail High School",
    totalEnrollment: 2100,
    status: "ACTIVE",
    contractStartDate: new Date("2026-08-01"),
    contractEndDate: new Date("2027-05-31"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.organization.findUniqueOrThrow.mockResolvedValue(org());
  mocked.studentMembership.findMany.mockResolvedValue([]);
  mocked.studentMembership.count.mockResolvedValue(0);
  mocked.finalizedAttempt.findMany.mockResolvedValue([]);
  mocked.diagnosticAttempt.findMany.mockResolvedValue([]);
  mocked.practiceSet.findMany.mockResolvedValue([]);
  mocked.diagnosticSession.findMany.mockResolvedValue([]);
  mocked.predictionHistoryEntry.findMany.mockResolvedValue([]);
});

describe("getAdminOverviewData", () => {
  it("computes Registration Percentage from Registered PrepHub Students over Total School Enrollment (PRD-011 §9)", async () => {
    mocked.organization.findUniqueOrThrow.mockResolvedValue(org({ totalEnrollment: 2100 }));
    mocked.studentMembership.count.mockResolvedValue(840);

    const result = await getAdminOverviewData("school1");

    expect(result.enrollment).toEqual({
      totalSchoolEnrollment: 2100,
      registeredStudents: 840,
      registrationPercentage: 40,
    });
  });

  it("returns a null Registration Percentage when the Owner hasn't set Total School Enrollment yet", async () => {
    mocked.organization.findUniqueOrThrow.mockResolvedValue(org({ totalEnrollment: null }));
    mocked.studentMembership.count.mockResolvedValue(50);

    const result = await getAdminOverviewData("school1");

    expect(result.enrollment.registrationPercentage).toBeNull();
  });

  it("counts registered students regardless of membership status — registration is a historical fact, not a live entitlement", async () => {
    await getAdminOverviewData("school1");

    expect(mocked.studentMembership.count).toHaveBeenCalledWith({ where: { schoolId: "school1" } });
  });

  it("reuses the shared school aggregate stats rather than re-deriving them", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }]);
    mocked.finalizedAttempt.findMany.mockResolvedValue([{ studentId: "s1", finalizedAt: new Date() }]);

    const result = await getAdminOverviewData("school1");

    expect(result.stats.totalQuestionsAnswered).toBe(1);
  });

  it("exposes access status and contract dates for the School Access section", async () => {
    mocked.organization.findUniqueOrThrow.mockResolvedValue(org({ status: "SUSPENDED" }));

    const result = await getAdminOverviewData("school1");

    expect(result.access.status).toBe("SUSPENDED");
  });

  it("never leaks a per-student breakdown in the returned shape", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([{ studentId: "s1" }, { studentId: "s2" }]);
    mocked.finalizedAttempt.findMany.mockResolvedValue([
      { studentId: "s1", finalizedAt: new Date() },
      { studentId: "s2", finalizedAt: new Date() },
    ]);

    const result = await getAdminOverviewData("school1");

    expect(JSON.stringify(result)).not.toContain("s1");
    expect(JSON.stringify(result)).not.toContain("s2");
  });
});
