import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getClassroomDetail, listClassrooms } from "@/lib/teacher/classrooms";
import type { TeacherContext } from "@/lib/teacher/access";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    classroom: { findUnique: vi.fn(), findMany: vi.fn() },
    classroomEnrollment: { findMany: vi.fn() },
    assignment: { findMany: vi.fn() },
    homeworkSession: { findMany: vi.fn() },
  },
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logUnauthorizedAccess: vi.fn() }));

const mocked = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const teacher: TeacherContext = {
  userId: "t1",
  firstName: "Rosa",
  teacherDisplayName: null,
  schoolId: "school1",
  schoolName: "Northwest HS",
};
const joined = new Date("2026-10-01");

beforeEach(() => {
  vi.clearAllMocks();
  mocked.classroom.findUnique.mockResolvedValue({ id: "c1", name: "3rd period", joinCode: "ACDEFG", teacherId: "t1", schoolId: "school1", archivedAt: null });
  mocked.assignment.findMany.mockResolvedValue([]);
  mocked.homeworkSession.findMany.mockResolvedValue([]);
});

function classRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    name: "3rd period",
    joinCode: "ACDEFG",
    archivedAt: null,
    _count: { assignments: 1 },
    enrollments: [
      { studentId: "ada", joinedAt: joined },
      { studentId: "ben", joinedAt: joined },
    ],
    assignments: [],
    ...overrides,
  };
}

describe("listClassrooms", () => {
  it("counts the next homework's finished work from students still in the class only", async () => {
    mocked.classroom.findMany.mockResolvedValue([
      classRow({
        assignments: [
          {
            id: "a1",
            title: "HW",
            dueAt: new Date("2026-11-10"),
            // Dee finished, then left the class.
            sessions: [{ studentId: "ada" }, { studentId: "dee" }],
          },
        ],
      }),
    ]);

    const [c] = await listClassrooms(teacher, new Date("2026-11-01"));

    expect(c.studentCount).toBe(2);
    expect(c.nextDue).toMatchObject({ id: "a1", completed: 1 });
    expect(c.overdue).toBeNull();
  });

  it("surfaces the most recent past-due homework still owed, so nothing due next doesn't hide it", async () => {
    mocked.classroom.findMany.mockResolvedValue([
      classRow({ enrollments: [...classRow().enrollments, { studentId: "eve", joinedAt: new Date("2026-10-30") }] }),
    ]);
    // Newest due first, as the query orders them.
    mocked.assignment.findMany.mockResolvedValue([
      { id: "a2", classroomId: "c1", title: "Week 2", dueAt: new Date("2026-10-29T05:59:59Z"), closedAt: null },
      { id: "a1", classroomId: "c1", title: "Week 1", dueAt: new Date("2026-10-22T05:59:59Z"), closedAt: null },
    ]);
    mocked.homeworkSession.findMany.mockResolvedValue([{ assignmentId: "a2", studentId: "ada" }]);

    const [c] = await listClassrooms(teacher, new Date("2026-11-01"));

    // Ben owes Week 2; Eve joined after it was due, so she doesn't.
    expect(c.overdue).toEqual({ id: "a2", title: "Week 2", dueAt: new Date("2026-10-29T05:59:59Z"), unfinished: 1 });
    expect(c.nextDue).toBeNull();
    expect(mocked.homeworkSession.findMany.mock.calls[0][0].where).toEqual({ assignmentId: { in: ["a2"] }, status: "COMPLETED" });
  });

  it("shows nothing overdue once everyone in the class has finished it", async () => {
    mocked.classroom.findMany.mockResolvedValue([classRow()]);
    mocked.assignment.findMany.mockResolvedValue([
      { id: "a1", classroomId: "c1", title: "Week 1", dueAt: new Date("2026-10-22T05:59:59Z"), closedAt: null },
    ]);
    mocked.homeworkSession.findMany.mockResolvedValue([
      { assignmentId: "a1", studentId: "ada" },
      { assignmentId: "a1", studentId: "ben" },
    ]);

    const [c] = await listClassrooms(teacher, new Date("2026-11-01"));
    expect(c.overdue).toBeNull();
  });
});

describe("getClassroomDetail", () => {
  const four = { _count: { questions: 4 } };

  it("counts each homework's progress and average against the current roster, so it never exceeds it", async () => {
    mocked.classroomEnrollment.findMany.mockResolvedValue([
      { joinedAt: joined, removedAt: null, lastName: null, student: { id: "ada", firstName: "Ada", email: "ada@x.org" } },
      { joinedAt: joined, removedAt: null, lastName: null, student: { id: "ben", firstName: "Ben", email: "ben@x.org" } },
    ]);
    const closedAt = new Date("2026-11-05");
    mocked.assignment.findMany.mockResolvedValue([
      { id: "a1", title: "HW", dueAt: null, closedAt, createdAt: new Date("2026-10-20"), ...four },
    ]);
    mocked.homeworkSession.findMany.mockResolvedValue([
      { assignmentId: "a1", studentId: "ada", status: "COMPLETED", completedAt: new Date("2026-11-01"), _count: { slots: 2 } },
      { assignmentId: "a1", studentId: "ben", status: "ACTIVE", completedAt: null, _count: { slots: 1 } },
      // Not on the roster: never one of the two.
      { assignmentId: "a1", studentId: "dee", status: "COMPLETED", completedAt: new Date("2026-11-01"), _count: { slots: 4 } },
    ]);

    const detail = await getClassroomDetail(teacher, "c1");

    expect(detail.assignments[0]).toMatchObject({ completed: 1, inProgress: 1, averagePercent: 50, closedAt, closed: true });
    expect(detail.students.map((s) => [s.studentId, s.completedAssignments])).toEqual([
      ["ada", 1],
      ["ben", 0],
    ]);
  });

  it("keeps students who left after doing work, apart from the roster, and marks late work the way the results page does", async () => {
    const due = new Date("2026-11-05T05:59:59Z");
    mocked.classroomEnrollment.findMany.mockResolvedValue([
      { joinedAt: joined, removedAt: null, lastName: "Lovelace", student: { id: "ada", firstName: "Ada", email: "ada@x.org" } },
      // Joined after it was due and did it anyway: never late.
      { joinedAt: new Date("2026-11-07"), removedAt: null, lastName: null, student: { id: "fay", firstName: "Fay", email: "fay@x.org" } },
      { joinedAt: joined, removedAt: new Date("2026-11-08"), lastName: "Young", student: { id: "dee", firstName: "Dee", email: "dee@x.org" } },
      // Removed before doing anything: no grade to keep.
      { joinedAt: joined, removedAt: new Date("2026-10-15"), lastName: null, student: { id: "gus", firstName: "Gus", email: "gus@x.org" } },
    ]);
    mocked.assignment.findMany.mockResolvedValue([
      { id: "a1", title: "HW", dueAt: due, closedAt: null, createdAt: new Date("2026-11-01"), ...four },
    ]);
    mocked.homeworkSession.findMany.mockResolvedValue([
      { assignmentId: "a1", studentId: "ada", status: "COMPLETED", completedAt: new Date("2026-11-06"), _count: { slots: 3 } },
      { assignmentId: "a1", studentId: "fay", status: "COMPLETED", completedAt: new Date("2026-11-09"), _count: { slots: 4 } },
      { assignmentId: "a1", studentId: "dee", status: "COMPLETED", completedAt: new Date("2026-11-04"), _count: { slots: 2 } },
    ]);

    const detail = await getClassroomDetail(teacher, "c1");

    expect(detail.students.map((s) => s.studentId)).toEqual(["ada", "fay"]);
    expect(detail.formerStudents).toEqual([
      expect.objectContaining({ studentId: "dee", lastName: "Young", completedAssignments: 1, leftAt: new Date("2026-11-08") }),
    ]);
    const late = Object.fromEntries(detail.submissions.map((s) => [s.studentId, s.late]));
    expect(late).toEqual({ ada: true, fay: false, dee: false });
    // "Of the class" stays the current roster: Dee's finished work isn't one of them.
    expect(detail.assignments[0]).toMatchObject({ completed: 2 });
  });
});
