import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeStudentDirectorySummary,
  getStudentDirectory,
  graduationYearWindow,
  matchesActivity,
  updateStudentInfo,
} from "@/lib/admin/student-directory";
import { AdminError } from "@/lib/admin/errors";
import { flattenSql, installActivityQueryMock, type ActivityFixture } from "@/lib/school/test-fixtures";
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

describe("activity filters", () => {
  const NOW = new Date("2026-10-25T12:00:00Z");
  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
  const membership = (n: number) => ({
    id: `m${n}`,
    studentId: `s${n}`,
    verifiedSchoolEmail: `s${n}@school.edu`,
    expectedGraduationYear: 2027,
    status: "ACTIVE",
    activatedAt: new Date("2026-09-01"),
    student: { firstName: `S${n}` },
  });

  beforeEach(() => {
    // s1 practiced yesterday; s2 last practiced three weeks ago; s3 never has.
    fixture.answers.push(
      { studentId: "s1", answeredAt: daysAgo(1) },
      { studentId: "s2", answeredAt: daysAgo(21) },
    );
  });

  it("narrows to students who have never answered a question, before paging", async () => {
    mocked.studentMembership.findMany
      .mockResolvedValueOnce([membership(1), membership(2), membership(3)].map(({ id, studentId }) => ({ id, studentId })))
      .mockResolvedValueOnce([membership(3)]);

    const result = await getStudentDirectory("school1", { activity: "NOT_STARTED" }, NOW);

    expect(result.total).toBe(1);
    expect(result.entries.map((e) => e.membershipId)).toEqual(["m3"]);
    // The page is fetched by the narrowed ids, not by skip/take over everyone.
    expect(mocked.studentMembership.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: { in: ["m3"] } } }),
    );
    expect(mocked.studentMembership.count).not.toHaveBeenCalled();
  });

  it("finds students active this week, and ones who started but have gone quiet", async () => {
    const ids = [membership(1), membership(2), membership(3)].map(({ id, studentId }) => ({ id, studentId }));
    mocked.studentMembership.findMany.mockResolvedValueOnce(ids).mockResolvedValueOnce([membership(1)]);
    expect((await getStudentDirectory("school1", { activity: "ACTIVE_THIS_WEEK" }, NOW)).total).toBe(1);

    mocked.studentMembership.findMany.mockResolvedValueOnce(ids).mockResolvedValueOnce([membership(2)]);
    const quiet = await getStudentDirectory("school1", { activity: "GONE_QUIET" }, NOW);
    expect(quiet.total).toBe(1);
    expect(mocked.studentMembership.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: { in: ["m2"] } } }),
    );
  });

  it("summarises the same groups the filters show, over students with live access", async () => {
    mocked.studentMembership.count.mockImplementation(({ where }: { where: { status?: string } }) =>
      Promise.resolve(where.status === "ACTIVE" ? 3 : 4),
    );

    expect(await computeStudentDirectorySummary("school1", NOW)).toEqual({
      registered: 4,
      active: 3,
      notStarted: 1,
      activeThisWeek: 1,
      goneQuiet: 1,
    });
  });

  it("reads every student's last answer once, scoped to the school in the database rather than by a list of ids", async () => {
    mocked.studentMembership.count.mockResolvedValue(3);

    await computeStudentDirectorySummary("school1", NOW);

    expect(mocked.$queryRaw).toHaveBeenCalledTimes(1);
    const { text, values } = flattenSql(mocked.$queryRaw.mock.calls[0]);
    expect(text).toContain('m."schoolId" =');
    expect(text).toContain(`m."status" = 'ACTIVE'`);
    // One bound value per answer table, whatever the size of the school.
    expect(values.filter((v) => v === "school1").length).toBe(7);
  });

  it("puts a student in exactly the groups their last answer says", () => {
    expect(matchesActivity("NOT_STARTED", undefined, NOW)).toBe(true);
    expect(matchesActivity("ACTIVE_THIS_WEEK", undefined, NOW)).toBe(false);
    expect(matchesActivity("ACTIVE_THIS_WEEK", daysAgo(7), NOW)).toBe(true);
    expect(matchesActivity("GONE_QUIET", daysAgo(14), NOW)).toBe(false);
    expect(matchesActivity("GONE_QUIET", daysAgo(15), NOW)).toBe(true);
    expect(matchesActivity("NOT_STARTED", daysAgo(400), NOW)).toBe(false);
  });
});

describe("updateStudentInfo", () => {
  // October 2026: the class of 2026 has already graduated, 2027 is next.
  const NOW = new Date("2026-10-25T12:00:00Z");
  const membership = (overrides: Record<string, unknown> = {}) => ({
    id: "m1",
    schoolId: "school1",
    studentId: "s1",
    status: "ACTIVE",
    expectedGraduationYear: 2028,
    ...overrides,
  });

  it("updates first name and graduation year when the membership belongs to this school", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue(membership());

    await updateStudentInfo("school1", "m1", { firstName: "Beatrice", expectedGraduationYear: 2029 }, NOW);

    expect(mocked.$transaction).toHaveBeenCalled();
  });

  it("refuses to edit a membership that belongs to a different school", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue(membership({ schoolId: "other-school" }));

    await expect(
      updateStudentInfo("school1", "m1", { firstName: "Beatrice", expectedGraduationYear: 2029 }, NOW),
    ).rejects.toThrow(AdminError);
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to edit a membership that does not exist", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue(null);

    await expect(
      updateStudentInfo("school1", "missing", { firstName: "Beatrice", expectedGraduationYear: 2029 }, NOW),
    ).rejects.toThrow(AdminError);
  });

  it("refuses a class year that would end the student's access, saying so", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue(membership({ expectedGraduationYear: 2027 }));

    // 2026 for 2027 — one keystroke, and the junior's Premium ended on the spot.
    await expect(
      updateStudentInfo("school1", "m1", { firstName: "Ada", expectedGraduationYear: 2026 }, NOW),
    ).rejects.toThrow("would end this student's school access");
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });

  it("refuses an implausibly distant class year", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue(membership());

    await expect(
      updateStudentInfo("school1", "m1", { firstName: "Ada", expectedGraduationYear: 2207 }, NOW),
    ).rejects.toThrow("from 2027 to 2032");
  });

  it("still lets a first name be fixed when the year on file is outside the window", async () => {
    mocked.studentMembership.findUnique.mockResolvedValue(membership({ expectedGraduationYear: 2040 }));

    await updateStudentInfo("school1", "m1", { firstName: "Ada", expectedGraduationYear: 2040 }, NOW);

    expect(mocked.$transaction).toHaveBeenCalled();
  });

  it("refuses to edit a student whose access has already ended", async () => {
    for (const status of ["REMOVED", "GRADUATED"]) {
      mocked.studentMembership.findUnique.mockResolvedValue(membership({ status }));
      await expect(
        updateStudentInfo("school1", "m1", { firstName: "Ada", expectedGraduationYear: 2028 }, NOW),
      ).rejects.toThrow("Only students who have access right now");
    }
    expect(mocked.$transaction).not.toHaveBeenCalled();
  });
});

describe("graduationYearWindow", () => {
  it("starts at the next class to graduate, on either side of the July rollover", () => {
    expect(graduationYearWindow(new Date("2027-06-30T12:00:00Z"))).toEqual({ min: 2027, max: 2032 });
    expect(graduationYearWindow(new Date("2027-07-01T12:00:00Z"))).toEqual({ min: 2028, max: 2033 });
  });
});
