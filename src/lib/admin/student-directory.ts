import type { MembershipStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { logUnauthorizedAccess } from "@/lib/logger";
import { AdminError } from "./errors";

export type StudentDirectoryFilters = {
  search?: string;
  graduationYear?: number;
  status?: MembershipStatus;
};

export type StudentDirectoryEntry = {
  membershipId: string;
  firstName: string;
  schoolEmail: string;
  graduationYear: number;
  status: MembershipStatus;
  registeredAt: Date;
  lastActiveAt: Date | null;
};

// PRD-011 §12 — the directory's field list is a deliberately narrow slice of
// account/administrative metadata; it structurally cannot carry any academic
// field because none is ever selected out of the database here (§21 — the
// dashboard should not let an admin reverse-engineer performance from what's
// shown, and the simplest guarantee of that is not fetching it at all).
export async function getStudentDirectory(
  schoolId: string,
  filters: StudentDirectoryFilters = {},
): Promise<StudentDirectoryEntry[]> {
  const where: Prisma.StudentMembershipWhereInput = {
    schoolId,
    ...(filters.graduationYear ? { expectedGraduationYear: filters.graduationYear } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.search
      ? {
          OR: [
            { student: { firstName: { contains: filters.search, mode: "insensitive" } } },
            { verifiedSchoolEmail: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const memberships = await prisma.studentMembership.findMany({
    where,
    select: {
      id: true,
      studentId: true,
      verifiedSchoolEmail: true,
      expectedGraduationYear: true,
      status: true,
      activatedAt: true,
      student: { select: { firstName: true } },
    },
    orderBy: { activatedAt: "desc" },
  });

  if (memberships.length === 0) return [];

  const studentIds = memberships.map((m) => m.studentId);

  // "Last Active Date" has no dedicated column — it's derived as the most
  // recent of any learning activity across the three places it's recorded.
  const [finalizedMax, practiceSetMax, diagnosticSessions] = await Promise.all([
    prisma.finalizedAttempt.groupBy({
      by: ["studentId"],
      where: { studentId: { in: studentIds } },
      _max: { finalizedAt: true },
    }),
    prisma.practiceSet.groupBy({
      by: ["studentId"],
      where: { studentId: { in: studentIds }, completedAt: { not: null } },
      _max: { completedAt: true },
    }),
    prisma.diagnosticSession.findMany({
      where: { studentId: { in: studentIds }, completedAt: { not: null } },
      select: { studentId: true, completedAt: true },
    }),
  ]);

  const lastActiveByStudent = new Map<string, Date>();
  const considerActivity = (studentId: string, at: Date | null | undefined) => {
    if (!at) return;
    const current = lastActiveByStudent.get(studentId);
    if (!current || at > current) lastActiveByStudent.set(studentId, at);
  };
  for (const row of finalizedMax) considerActivity(row.studentId, row._max.finalizedAt);
  for (const row of practiceSetMax) considerActivity(row.studentId, row._max.completedAt);
  for (const row of diagnosticSessions) considerActivity(row.studentId, row.completedAt);

  return memberships.map((m) => ({
    membershipId: m.id,
    firstName: m.student.firstName,
    schoolEmail: m.verifiedSchoolEmail,
    graduationYear: m.expectedGraduationYear,
    status: m.status,
    registeredAt: m.activatedAt,
    lastActiveAt: lastActiveByStudent.get(m.studentId) ?? null,
  }));
}

// PRD-011 §14 — the only two fields an Administrator may correct. Scoped to
// `schoolId` so an admin can never edit a membership at another school, even
// by guessing/replaying a membershipId (server-side authorization, not a
// hidden-UI convention).
export async function updateStudentInfo(
  schoolId: string,
  membershipId: string,
  input: { firstName: string; expectedGraduationYear: number },
): Promise<void> {
  const membership = await prisma.studentMembership.findUnique({ where: { id: membershipId } });
  if (!membership) {
    throw new AdminError("MEMBERSHIP_NOT_FOUND", "Student not found at this school.");
  }
  if (membership.schoolId !== schoolId) {
    // GER §6: an Administrator must never edit a student outside their
    // assigned school — this fires when the membership exists but belongs
    // to a different school, e.g. an id guessed or copied from elsewhere.
    logUnauthorizedAccess("Administrator attempted to edit a student at another school", {
      organizationId: schoolId,
      affectedResourceId: membershipId,
    });
    throw new AdminError("MEMBERSHIP_NOT_FOUND", "Student not found at this school.");
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: membership.studentId }, data: { firstName: input.firstName } }),
    prisma.studentMembership.update({
      where: { id: membershipId },
      data: { expectedGraduationYear: input.expectedGraduationYear },
    }),
  ]);
}
