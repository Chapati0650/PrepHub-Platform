import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStudentDirectory, updateStudentInfo } from "@/lib/admin/student-directory";
import { AdminError } from "@/lib/admin/errors";
import { installActivityQueryMock, type ActivityFixture } from "@/lib/school/test-fixtures";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    studentMembership: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    user: { update: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as {
  studentMembership: Record<string, ReturnType<typeof vi.fn>>;
  user: Record<string, ReturnType<typeof vi.fn>>;
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
};

let fixture: ActivityFixture;

beforeEach(() => {
  vi.clearAllMocks();
  // The directory counts before it pages. A default larger than any fixture
  // keeps page one returning whatever findMany is mocked to give.
  mocked.studentMembership.count.mockResolvedValue(100);
  mocked.$transaction.mockResolvedValue(undefined);
  fixture = installActivityQueryMock(mocked.$queryRaw, { answers: [], sessions: [], predictions: [] });
});

describe("getStudentDirectory", () => {
  it("returns an empty list without querying activity when the school has no memberships", async () => {
    mocked.studentMembership.findMany.mockResolvedValue([]);

    const result = await getStudentDirectory("school1");

    expect(result.entries).toEqual([]);
    expect(mocked.$queryRaw).not.toHaveBeenCalled();
  });

  it("exposes account, administrative and engagement fields — never academic data — for a listed student", async () => {
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

    expect(result.entries).toEqual([
      {
        membershipId: "m1",
        firstName: "Ada",
        schoolEmail: "ada@school.edu",
        graduationYear: 2027,
        status: "ACTIVE",
        registeredAt: new Date("2026-01-01"),
        lastActiveAt: null,
        activity: { questionsAnswered: 0, sessionsCompleted: 0, studyHours: 0, lastActiveAt: null },
      },
    ]);
    // Engagement is how much work, never how well it went. No correctness,
    // ability, mastery or predicted-score field is selected anywhere here.
    const serialized = JSON.stringify(result.entries[0]);
    for (const forbidden of ["ability", "predictedScore", "isCorrect", "mastery", "accuracy"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("reports a student's engagement and derives Last Active Date as the most recent of any activity", async () => {
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
    fixture.answers = [
      { studentId: "s1", answeredAt: new Date("2026-02-01") },
      { studentId: "s1", answeredAt: new Date("2026-03-01") },
    ];
    fixture.sessions = [
      {
        studentId: "s1",
        startedAt: new Date("2026-05-01T10:00:00Z"),
        completedAt: new Date("2026-05-01T10:30:00Z"),
      },
    ];

    const result = await getStudentDirectory("school1");

    expect(result.entries[0].activity).toEqual({
      questionsAnswered: 2,
      sessionsCompleted: 1,
      studyHours: 0.5,
      lastActiveAt: new Date("2026-05-01T10:30:00Z"),
    });
    expect(result.entries[0].lastActiveAt).toEqual(new Date("2026-05-01T10:30:00Z"));
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
