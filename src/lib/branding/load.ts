import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { resolveBranding, type BrandingSource, type OrganizationBranding } from "./resolve";

const BRANDING_SELECT = { officialName: true, logoMediaId: true, brandName: true, brandColor: true } as const;
const WITH_DISTRICT = { ...BRANDING_SELECT, parentDistrict: { select: BRANDING_SELECT } } as const;

/**
 * The branding a signed-in user sees, resolved once per request (React cache).
 *
 *  - student: the campus on their ACTIVE membership, falling back to the district
 *  - teacher: the first active school assignment
 *  - school/district administrator: the first active assignment's organization
 *  - owner: none (the Owner sees PrepHub only)
 */
export const getBrandingForUser = cache(async (userId: string, role: string): Promise<OrganizationBranding | null> => {
  if (role === "OWNER") return null;

  if (role === "TEACHER") {
    const a = await prisma.teacherAssignment.findFirst({
      where: { userId, removedAt: null, school: { archivedAt: null } },
      orderBy: { createdAt: "asc" },
      select: { school: { select: WITH_DISTRICT } },
    });
    return a ? resolveBranding(a.school, a.school.parentDistrict) : null;
  }

  if (role === "SCHOOL_ADMINISTRATOR") {
    const a = await prisma.administratorAssignment.findFirst({
      where: { userId, removedAt: null, organization: { archivedAt: null } },
      orderBy: { createdAt: "asc" },
      select: { organization: { select: WITH_DISTRICT } },
    });
    return a ? resolveBranding(a.organization, a.organization.parentDistrict) : null;
  }

  const m = await prisma.studentMembership.findUnique({
    where: { studentId: userId },
    select: { status: true, school: { select: WITH_DISTRICT }, organization: { select: BRANDING_SELECT } },
  });
  if (!m || m.status !== "ACTIVE") return null;
  // A district student not yet placed on a campus has schoolId = the district itself.
  const district: BrandingSource = m.school.parentDistrict ?? m.organization;
  return resolveBranding(m.school, district === m.school ? null : district);
});
