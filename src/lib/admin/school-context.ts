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
  // True when the Owner is previewing an administrator's view rather than an
  // Administrator using their own. Read-only: see requireAdminWriteContext.
  viewingAsOwner: boolean;
  // Only populated for the Owner, to drive the school switcher.
  availableSchools: { id: string; name: string }[];
};

// Shared by every administrator-only page (Admin Overview, Student
// Directory, Announcements, School Access & Support) so the role gate and
// the AdministratorAssignment-to-school resolution can't drift between them.
//
// The Owner is admitted deliberately (2026-10-17): they need to see exactly
// what a district sees before a demo, and issuing themselves a second
// SCHOOL_ADMINISTRATOR account to do it would mean maintaining a fake
// membership and would pollute the very aggregates they are inspecting. The
// Owner picks the school explicitly via `requestedSchoolId`; nothing is
// inferred from their own records, because they have none.
export async function requireAdminSchoolContext(
  requestedSchoolId?: string,
): Promise<AdminSchoolContext> {
  const session = await auth();
  if (!session?.user) redirect("/home");

  if (session.user.role === "OWNER") {
    const schools = await prisma.organization.findMany({
      where: { organizationType: "SCHOOL" },
      orderBy: { officialName: "asc" },
      select: { id: true, officialName: true },
    });
    // An unknown or omitted id falls back to the first school rather than
    // erroring — a stale bookmark should land somewhere sensible, and a
    // guessed id still cannot reach anything the Owner may not already see.
    const chosen = schools.find((s) => s.id === requestedSchoolId) ?? schools[0];
    return {
      userId: session.user.id,
      schoolId: chosen?.id ?? null,
      viewingAsOwner: true,
      availableSchools: schools.map((s) => ({ id: s.id, name: s.officialName })),
    };
  }

  if (session.user.role !== "SCHOOL_ADMINISTRATOR") {
    logUnauthorizedAccess("Non-Administrator attempted an Administrator-only area", {
      accountId: session.user.id,
      role: session.user.role,
    });
    redirect("/home");
  }

  const assignment = await prisma.administratorAssignment.findFirst({
    where: {
      userId: session.user.id,
      removedAt: null,
      organization: { organizationType: "SCHOOL" },
    },
    select: { organizationId: true },
  });

  return {
    userId: session.user.id,
    // An Administrator is scoped to their own assignment and nothing else —
    // requestedSchoolId is deliberately ignored here, so a hand-edited URL
    // cannot move them to another school.
    schoolId: assignment?.organizationId ?? null,
    viewingAsOwner: false,
    availableSchools: [],
  };
}

/**
 * The same gate for the administrator area's *write* actions (publishing an
 * announcement, editing a student record).
 *
 * The Owner's preview is read-only on purpose. Publishing an announcement
 * emails every registered student at that school immediately and cannot be
 * un-sent, so "look at what they see" must not carry the ability to do it by
 * accident from a school-switcher dropdown.
 */
export async function requireAdminWriteContext(): Promise<
  { schoolId: string; userId: string } | { error: string }
> {
  const context = await requireAdminSchoolContext();
  if (context.viewingAsOwner) {
    return { error: "This is a read-only preview of the administrator view." };
  }
  if (!context.schoolId) return { error: "Not authorized." };
  return { schoolId: context.schoolId, userId: context.userId };
}
