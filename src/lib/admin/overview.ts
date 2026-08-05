import type { OrganizationStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSchoolAggregateStats, type SchoolAggregateStats } from "@/lib/school/aggregate-stats";

export type AdminOverviewData = {
  schoolName: string;
  enrollment: {
    // null until the Owner sets it (PRD-011 §9) — Registration Percentage is
    // then not shown rather than computed against a missing denominator.
    totalSchoolEnrollment: number | null;
    registeredStudents: number;
    registrationPercentage: number | null;
  };
  stats: SchoolAggregateStats;
  access: {
    status: OrganizationStatus;
    contractStartDate: Date;
    contractEndDate: Date;
  };
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
  const [registeredStudents, { stats }] = await Promise.all([
    prisma.studentMembership.count({ where: { schoolId } }),
    getSchoolAggregateStats(schoolId),
  ]);

  const registrationPercentage =
    org.totalEnrollment && org.totalEnrollment > 0
      ? Math.round((registeredStudents / org.totalEnrollment) * 100)
      : null;

  return {
    schoolName: org.officialName,
    enrollment: {
      totalSchoolEnrollment: org.totalEnrollment,
      registeredStudents,
      registrationPercentage,
    },
    stats,
    access: {
      status: org.status,
      contractStartDate: org.contractStartDate,
      contractEndDate: org.contractEndDate,
    },
  };
}
