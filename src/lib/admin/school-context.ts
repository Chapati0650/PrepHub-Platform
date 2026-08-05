import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logUnauthorizedAccess } from "@/lib/logger";

export type AdminSchoolContext = {
  userId: string;
  // null for a district-scoped AdministratorAssignment (or no assignment at
  // all yet) — PRD-011's admin-only pages are scoped to exactly one school
  // (§5: "The account is associated with: One school"), so district-level
  // oversight is out of scope for V1 and callers should render a
  // not-applicable empty state rather than a school's data.
  schoolId: string | null;
};

// Shared by every administrator-only page (Admin Overview, Student
// Directory, Announcements, School Access & Support) so the
// SCHOOL_ADMINISTRATOR-role gate and the AdministratorAssignment-to-school
// resolution can't drift between them.
export async function requireAdminSchoolContext(): Promise<AdminSchoolContext> {
  const session = await auth();
  if (!session?.user) redirect("/home");
  if (session.user.role !== "SCHOOL_ADMINISTRATOR") {
    logUnauthorizedAccess("Non-Administrator attempted an Administrator-only area", {
      accountId: session.user.id,
      role: session.user.role,
    });
    redirect("/home");
  }

  const assignment = await prisma.administratorAssignment.findFirst({
    where: { userId: session.user.id, removedAt: null, organization: { organizationType: "SCHOOL" } },
    select: { organizationId: true },
  });

  return { userId: session.user.id, schoolId: assignment?.organizationId ?? null };
}
