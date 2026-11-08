import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logUnauthorizedAccess } from "@/lib/logger";
import { resolveDistrictCampus, type Campus } from "./campus-scope";

export type AdminSchoolContext = {
  userId: string;
  // The one campus the page shows. null when there is no assignment yet, or
  // when a district administrator has not (validly) picked a campus: the
  // district views (`/admin` overview) then show every campus, and the
  // single-campus pages ask for a choice.
  schoolId: string | null;
  // True when the Owner is previewing an administrator's view rather than an
  // Administrator using their own. Read-only: see requireAdminWriteContext.
  viewingAsOwner: boolean;
  // Only populated for the Owner, to drive the school switcher.
  availableSchools: { id: string; name: string }[];
  // A DISTRICT-scope administrator (2026-11-08): their district and its
  // campuses (SCHOOL organizations whose parentDistrictId is the district).
  // null for everyone else.
  district: { id: string; name: string; campuses: Campus[] } | null;
  // True when links must carry `?school=` to keep the chosen campus: the
  // Owner's preview and district administrators.
  carryCampusParam: boolean;
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
      district: null,
      carryCampusParam: true,
    };
  }

  if (session.user.role !== "SCHOOL_ADMINISTRATOR") {
    logUnauthorizedAccess("Non-Administrator attempted an Administrator-only area", {
      accountId: session.user.id,
      role: session.user.role,
    });
    redirect("/home");
  }

  const districtAssignment = await prisma.administratorAssignment.findFirst({
    where: {
      userId: session.user.id,
      removedAt: null,
      scope: "DISTRICT",
      organization: { organizationType: "DISTRICT" },
    },
    orderBy: { createdAt: "asc" },
    select: { organization: { select: { id: true, officialName: true } } },
  });

  if (districtAssignment) {
    const district = districtAssignment.organization;
    const rows = await prisma.organization.findMany({
      where: { organizationType: "SCHOOL", parentDistrictId: district.id },
      orderBy: { officialName: "asc" },
      select: { id: true, officialName: true },
    });
    const campuses = rows.map((r) => ({ id: r.id, name: r.officialName }));
    return {
      userId: session.user.id,
      // Only a campus of this district can be chosen; anything else is "no
      // campus chosen", never another district's school.
      schoolId: resolveDistrictCampus(campuses, requestedSchoolId)?.id ?? null,
      viewingAsOwner: false,
      availableSchools: [],
      district: { id: district.id, name: district.officialName, campuses },
      carryCampusParam: true,
    };
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
    // A campus Administrator is scoped to their own assignment and nothing
    // else: requestedSchoolId is deliberately ignored here, so a hand-edited
    // URL cannot move them to another school.
    schoolId: assignment?.organizationId ?? null,
    viewingAsOwner: false,
    availableSchools: [],
    district: null,
    carryCampusParam: false,
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
export async function requireAdminWriteContext(
  requestedSchoolId?: string | null,
): Promise<{ schoolId: string; userId: string } | { error: string }> {
  // A server action has no URL, so a district administrator's campus is the
  // `school` field of the form they submitted; it is checked against their
  // district like any other request.
  const context = await requireAdminSchoolContext(requestedSchoolId || undefined);
  if (context.viewingAsOwner) {
    return { error: "This is a read-only preview of the administrator view." };
  }
  if (context.district && !context.schoolId) {
    return { error: "Choose a campus first, then try again." };
  }
  if (!context.schoolId) return { error: "Not authorized." };
  return { schoolId: context.schoolId, userId: context.userId };
}

/** The `school` field of a write form, or null. A request only: the context re-checks it. */
export function schoolField(formData: FormData): string | null {
  const value = formData.get("school");
  return typeof value === "string" && value ? value : null;
}
