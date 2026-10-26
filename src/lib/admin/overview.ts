import { prisma } from "@/lib/prisma";
import { getSchoolAggregateStats, type SchoolAggregateStats } from "@/lib/school/aggregate-stats";
import { getSchoolAccessInfo, type SchoolAccessInfo } from "./access-info";

export type AdminOverviewData = {
  schoolName: string;
  enrollment: {
    // null until the Owner sets it (PRD-011 §9) — Registration Percentage is
    // then not shown rather than computed against a missing denominator.
    totalSchoolEnrollment: number | null;
    registeredStudents: number;
    /** Of those, the ones whose membership is ACTIVE today. */
    activeStudents: number;
    registrationPercentage: number | null;
  };
  stats: SchoolAggregateStats;
  access: SchoolAccessInfo;
};

// PRD-011 §10 — the administrator-only landing page's all-time summary.
// `stats` reuses `getSchoolAggregateStats`, the exact same aggregate math
// School Community (PRD-009) already computes, so the two pages can never
// quietly disagree about what "Total Questions Answered" means for a
// school. Administrator activity is excluded the same structural way as
// School Community: both queries scope by `StudentMembership`, which an
// Administrator never has (they have an `AdministratorAssignment` instead).
export async function getAdminOverviewData(schoolId: string): Promise<AdminOverviewData> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: schoolId } });

  // "Registered PrepHub Students" (§9) is a historical association count,
  // not a live entitlement count — a student who later graduates or is
  // removed was still, factually, registered, so every status counts here.
  // This intentionally differs from `getSchoolAggregateStats`'s ACTIVE-only
  // scope, which represents the current community actively contributing to
  // school-wide activity totals.
  const [registeredStudents, activeStudents, { stats }, access] = await Promise.all([
    prisma.studentMembership.count({ where: { schoolId } }),
    prisma.studentMembership.count({ where: { schoolId, status: "ACTIVE" } }),
    getSchoolAggregateStats(schoolId),
    getSchoolAccessInfo(schoolId),
  ]);

  // The share of the school's enrollment is taken from the students enrolled
  // *now*. Every-status counting is right for "how many ever signed up", but
  // against this year's enrollment figure it counts last year's graduates
  // too, and a school a few years in could read as more than 100% signed up.
  const registrationPercentage =
    org.totalEnrollment && org.totalEnrollment > 0
      ? Math.round((activeStudents / org.totalEnrollment) * 100)
      : null;

  return {
    schoolName: org.officialName,
    enrollment: {
      totalSchoolEnrollment: org.totalEnrollment,
      registeredStudents,
      activeStudents,
      registrationPercentage,
    },
    stats,
    access,
  };
}

export type AdminSetupProgress = {
  studentsJoined: boolean;
  teachersAdded: boolean;
  announcementPosted: boolean;
  goalSet: boolean;
};

/**
 * The four things a new administrator does to get PrepHub going, read from
 * what the school already has rather than from a checklist anyone ticks — so
 * the Overview's "getting started" steps can't drift from the truth, and
 * disappear on their own once all four are done.
 */
export async function getAdminSetupProgress(schoolId: string): Promise<AdminSetupProgress> {
  const [students, teachers, announcements, org] = await Promise.all([
    prisma.studentMembership.count({ where: { schoolId } }),
    prisma.teacherAssignment.count({ where: { schoolId, removedAt: null } }),
    prisma.announcement.count({ where: { organizationId: schoolId } }),
    prisma.organization.findUnique({ where: { id: schoolId }, select: { communityGoalMetric: true } }),
  ]);
  return {
    studentsJoined: students > 0,
    teachersAdded: teachers > 0,
    announcementPosted: announcements > 0,
    goalSet: Boolean(org?.communityGoalMetric),
  };
}
