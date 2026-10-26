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
const teacher: TeacherContext = { userId: "t1", firstName: "Ms. R", schoolId: "school1", schoolName: "Northwest HS" };

beforeEach(() => {
  vi.clearAllMocks();
  mocked.classroom.findUnique.mockResolvedValue({ id: "c1", name: "3rd period", joinCode: "ACDEFG", teacherId: "t1", schoolId: "school1", archivedAt: null });
});

describe("listClassrooms", () => {
  it("counts the next homework's finished work from students still in the class only", async () => {
    mocked.classroom.findMany.mockResolvedValue([
      {
        id: "c1",
        name: "3rd period",
        joinCode: "ACDEFG",
        archivedAt: null,
        _count: { assignments: 1 },
        enrollments: [{ studentId: "ada" }, { studentId: "ben" }],
        assignments: [
          {
            id: "a1",
            title: "HW",
            dueAt: new Date("2026-11-10"),
            // Dee finished, then left the class.
            sessions: [{ studentId: "ada" }, { studentId: "dee" }],
          },
        ],
      },
    ]);

    const [c] = await listClassrooms(teacher, new Date("2026-11-01"));

    expect(c.studentCount).toBe(2);
    expect(c.nextDue).toMatchObject({ id: "a1", completed: 1 });
  });
});

describe("getClassroomDetail", () => {
  it("counts each homework's progress and average against the current roster, so it never exceeds it", async () => {
    mocked.classroomEnrollment.findMany.mockResolvedValue([
      { joinedAt: new Date("2026-10-01"), student: { id: "ada", firstName: "Ada", email: "ada@x.org" } },
      { joinedAt: new Date("2026-10-01"), student: { id: "ben", firstName: "Ben", email: "ben@x.org" } },
    ]);
    const closedAt = new Date("2026-11-05");
    mocked.assignment.findMany.mockResolvedValue([
      { id: "a1", title: "HW", dueAt: null, closedAt, createdAt: new Date("2026-10-20"), _count: { questions: 4 } },
    ]);
    const four = { _count: { questions: 4 } };
    mocked.homeworkSession.findMany.mockResolvedValue([
      { assignmentId: "a1", studentId: "ada", status: "COMPLETED", _count: { slots: 2 }, assignment: four },
      { assignmentId: "a1", studentId: "ben", status: "ACTIVE", _count: { slots: 1 }, assignment: four },
      // Left the class after finishing: not one of the two.
      { assignmentId: "a1", studentId: "dee", status: "COMPLETED", _count: { slots: 4 }, assignment: four },
    ]);

    const detail = await getClassroomDetail(teacher, "c1");

    expect(detail.assignments[0]).toMatchObject({ completed: 1, inProgress: 1, averagePercent: 50, closedAt, closed: true });
    expect(detail.students.map((s) => [s.studentId, s.completedAssignments])).toEqual([
      ["ada", 1],
      ["ben", 0],
    ]);
  });
});
