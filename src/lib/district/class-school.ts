import { prisma } from "@/lib/prisma";

/**
 * The school whose PrepHub access is live, for a student who's in one of its classes but isn't a member
 * of it (signed up with a personal address and joined by class code), or null (2026-11-09). Such a
 * student is shown how to switch the school's access on, never offered Premium for sale.
 */
export async function classSchoolCovering(studentId: string, now: Date = new Date()): Promise<{ name: string } | null> {
  const enrollment = await prisma.classroomEnrollment.findFirst({
    where: {
      studentId,
      removedAt: null,
      classroom: {
        archivedAt: null,
        school: { status: "ACTIVE", contractStartDate: { lte: now }, contractEndDate: { gte: now } },
      },
    },
    select: { classroom: { select: { school: { select: { officialName: true } } } } },
  });
  return enrollment ? { name: enrollment.classroom.school.officialName } : null;
}
