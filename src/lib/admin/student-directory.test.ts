import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStudentDirectory, updateStudentInfo } from "@/lib/admin/student-directory";
import { AdminError } from "@/lib/admin/errors";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    studentMembership: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    finalizedAttempt: { groupBy: vi.fn() },
    practiceSet: { groupBy: vi.fn() },
    diagnosticSession: { findMany: vi.fn() },
    user: { update: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as {
  studentMembership: Record<string, ReturnType<typeof vi.fn>>;
  finalizedAttempt: Record<string, ReturnType<typeof vi.fn>>;
  practiceSet: Record<string, ReturnType<typeof vi.fn>>;
  diagnosticSession: Record<string, ReturnType<typeof vi.fn>>;
  user: Record<string, ReturnType<typeof vi.fn>>;
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.finalizedAttempt.groupBy.mockResolvedValue([]);
  mocked.practiceSet.groupBy.mockResolvedValue([]);
  mocked.diagnosticSession.findMany.mockResolvedValue([]);
  mocked.$transaction.mockResolvedValue(undefined);
});

describe("getStudentDirectory", () => {
  it("returns an empty list without querying activity when the school has no memberships", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([]);

    const result = await getStudentDirectory("school1");

    expect(result).toEqual([]);
    expect(mocked.finalizedAttempt.groupBy).not.toHaveBeenCalled();
  });

  it("only exposes account/administrative fields — never academic data — for a listed student", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([
      {
        id: "m1",
        studentId: "s1",
        verifiedSchoolEmail: "ada@school.edu",
        expectedGraduationYear: 2027,
        status: "ACTIVE",
        activatedAt: new Date("2026-01-01"),
        student: { firstName: "Ada" },
      },
    ]);

    const result = await getStudentDirectory("school1");

    expect(result).toEqual([
      {
        membershipId: "m1",
        firstName: "Ada",
        schoolEmail: "ada@school.edu",
        graduationYear: 2027,
        status: "ACTIVE",
        registeredAt: new Date("2026-01-01"),
        lastActiveAt: null,
      },
    ]);
    expect(Object.keys(result[0])).not.toContain("ability");
    expect(Object.keys(result[0])).not.toContain("predictedScore");
  });

  it("derives Last Active Date as the most recent of finalized attempts, practice sets, and diagnostic completion", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([
      {
        id: "m1",
        studentId: "s1",
        verifiedSchoolEmail: "ada@school.edu",
        expectedGraduationYear: 2027,
        status: "ACTIVE",
        activatedAt: new Date("2026-01-01"),
        student: { firstName: "Ada" },
      },
    ]);
    mocked.finalizedAttempt.groupBy.mockResolvedValue([{ studentId: "s1", _max: { finalizedAt: new Date("2026-03-01") } }]);
    mocked.practiceSet.groupBy.mockResolvedValue([{ studentId: "s1", _max: { completedAt: new Date("2026-05-01") } }]);
    mocked.diagnosticSession.findMany.mockResolvedValue([{ studentId: "s1", completedAt: new Date("2026-02-01") }]);

    const result = await getStudentDirectory("school1");

    expect(result[0].lastActiveAt).toEqual(new Date("2026-05-01"));
  });

  it("passes graduation year and status filters through to the query", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([]);

    await getStudentDirectory("school1", { graduationYear: 2028, status: "GRADUATED", search: "ada" });

    expect(mocked.studentMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          schoolId: "school1",
          expectedGraduationYear: 2028,
          status: "GRADUATED",
        }),
      }),
    );
  });
});

describe("updateStudentInfo", () => {
  it("updates first name and graduation year when the membership belongs to this school", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue({ id: "m1", schoolId: "school1", studentId: "s1" });

    await updateStudentInfo("school1", "m1", { firstName: "Beatrice", expectedGraduationYear: 2029 });

    expect(mocked.$transaction).toHaveBeenCalled();
  });

  it("refuses to edit a membership that belongs to a different school", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue({ id: "m1", schoolId: "other-school", studentId: "s1" });

    await expect(
      updateStudentInfo("school1", "m1", { firstName: "Beatrice", expectedGraduationYear: 2029 }),
    ).rejects.toThrow(AdminError);
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to edit a membership that does not exist", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue(null);

    await expect(
      updateStudentInfo("school1", "missing", { firstName: "Beatrice", expectedGraduationYear: 2029 }),
    ).rejects.toThrow(AdminError);
  });
});
