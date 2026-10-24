import type { MembershipStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { logUnauthorizedAccess } from "@/lib/logger";
import {
  emptyStudentActivity,
  getStudentActivity,
  type StudentActivity,
} from "@/lib/school/student-activity";
import { AdminError } from "./errors";

export type StudentDirectoryFilters = {
  search?: string;
  graduationYear?: number;
  status?: MembershipStatus;
  /** 1-based. Out-of-range values are clamped rather than erroring. */
  page?: number;
};

/**
 * Rows per page.
 *
 * The directory used to return every membership at the school. That is fine
 * for a pilot campus and unusable for a district: a 2,000-student school meant
 * 2,000 rows fetched, three more unbounded queries to derive last-active, and
 * 2,000 table rows rendered into the HTML. Paging bounds all four.
 */
export const STUDENT_DIRECTORY_PAGE_SIZE = 50;

export type StudentDirectoryEntry = {
  membershipId: string;
  firstName: string;
  schoolEmail: string;
  graduationYear: number;
  status: MembershipStatus;
  registeredAt: Date;
  lastActiveAt: Date | null;
  /** Engagement, not performance — see the note below. */
  activity: StudentActivity;
};

// PRD-011 §12 — the directory's field list is account/administrative metadata
// plus engagement: how many questions a student has answered, how many
// sessions they finished, roughly how long they have spent, and when they were
// last here.
//
// The line this holds, and the reason it is drawn where it is: an
// Administrator sees *how much work* a student has done and never *how well*
// they did it. No correctness, ability, mastery or predicted-score field is
// selected out of the database anywhere in this file, which is a stronger
// guarantee than filtering one out later (§21 — the dashboard must not let an
// admin reverse-engineer performance from what's shown). PRD-011 §7 originally
// excluded engagement too; it was added on 2026-10-21 after an administrator
// asked for it directly, because "has this student even started?" is the
// question an intervention actually turns on. Per-student *scores* remain a
// separate decision and are deliberately not implied by this one.
export type StudentDirectoryPage = {
  entries: StudentDirectoryEntry[];
  total: number;
  page: number;
  pageCount: number;
};

export async function getStudentDirectory(
  schoolId: string,
  filters: StudentDirectoryFilters = {},
): Promise<StudentDirectoryPage> {
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

  const total = await prisma.studentMembership.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / STUDENT_DIRECTORY_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(filters.page ?? 1)), pageCount);

  const memberships = await prisma.studentMembership.findMany({
    where,
    skip: (page - 1) * STUDENT_DIRECTORY_PAGE_SIZE,
    take: STUDENT_DIRECTORY_PAGE_SIZE,
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

  if (memberships.length === 0) return { entries: [], total, page, pageCount };

  const studentIds = memberships.map((m) => m.studentId);

  // One query for the page's students, covering every table a student's
  // answers and sessions can land in. "Last Active Date" still has no
  // dedicated column — it is the most recent of any of them.
  const activity = await getStudentActivity(studentIds);

  return {
    entries: memberships.map((m) => {
      const studentActivity = activity.get(m.studentId) ?? emptyStudentActivity();
      return {
        membershipId: m.id,
        firstName: m.student.firstName,
        schoolEmail: m.verifiedSchoolEmail,
        graduationYear: m.expectedGraduationYear,
        status: m.status,
        registeredAt: m.activatedAt,
        lastActiveAt: studentActivity.lastActiveAt,
        activity: studentActivity,
      };
    }),
    total,
    page,
    pageCount,
  };
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
