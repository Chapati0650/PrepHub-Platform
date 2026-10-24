import { prisma } from "@/lib/prisma";
import { OwnerError } from "./errors";

export type ManualActivationInput = {
  studentEmail: string; // the student's PrepHub login email, to find their account
  organizationId: string;
  schoolId: string;
  verifiedSchoolEmail: string;
  currentGrade: number;
  expectedGraduationYear: number;
};

// PRD-017 §9/§17: an "exceptional support action" — the Owner activates access
// without the student completing self-service email verification. Still
// records a real school email for consistency with normal memberships.
export async function manuallyActivateStudent(input: ManualActivationInput) {
  const student = await prisma.user.findUnique({ where: { email: input.studentEmail } });
  if (!student || student.role !== "STUDENT") {
    throw new OwnerError("STUDENT_NOT_FOUND", "No student account found with that login email.");
  }

  const existing = await prisma.studentMembership.findUnique({ where: { studentId: student.id } });
  if (existing) {
    throw new OwnerError(
      "ALREADY_HAS_MEMBERSHIP",
      "This student already has school-provided access connected.",
    );
  }

  // One transaction, here and in every transition below. These were two
  // separate writes, and a failure between them left a membership whose
  // status change had no audit record - which is the entire purpose of
  // MembershipHistoryEvent (PRD-017 §16) and exactly what CLAUDE.md's
  // "membership activation/removal/graduation are atomic" invariant is about.
  return prisma.$transaction(async (tx) => {
    const membership = await tx.studentMembership.create({
      data: {
        studentId: student.id,
        organizationId: input.organizationId,
        schoolId: input.schoolId,
        verifiedSchoolEmail: input.verifiedSchoolEmail,
        currentGrade: input.currentGrade,
        expectedGraduationYear: input.expectedGraduationYear,
        activationMethod: "OWNER_OVERRIDE",
      },
    });

    await tx.membershipHistoryEvent.create({
      data: {
        membershipId: membership.id,
        eventType: "OWNER_OVERRIDE_ACTIVATION",
        newOrganizationId: input.organizationId,
      },
    });

    return membership;
  });
}

// PRD-017 §14: ends access immediately; preserves the account, progress, and
// historical reporting from the membership period.
export async function removeMembership(membershipId: string, performedByAccountId: string, reason?: string) {
  const membership = await prisma.studentMembership.findUnique({ where: { id: membershipId } });
  if (!membership) throw new OwnerError("MEMBERSHIP_NOT_FOUND", "Membership not found.");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.studentMembership.update({
      where: { id: membershipId },
      data: { status: "REMOVED", removedAt: new Date() },
    });

    await tx.membershipHistoryEvent.create({
      data: {
        membershipId,
        eventType: "REMOVAL",
        performedByAccountId,
        optionalReason: reason,
      },
    });

    return updated;
  });
}

// PRD-017 §14: reactivates the existing membership rather than creating a
// duplicate; only when the org is Active and the student hasn't graduated.
export async function restoreMembership(membershipId: string, performedByAccountId: string) {
  const membership = await prisma.studentMembership.findUnique({
    where: { id: membershipId },
    include: { organization: true },
  });
  if (!membership) throw new OwnerError("MEMBERSHIP_NOT_FOUND", "Membership not found.");
  if (membership.status !== "REMOVED") {
    throw new OwnerError("INVALID_INPUT", "Only a removed membership can be restored.");
  }
  if (membership.organization.status !== "ACTIVE") {
    throw new OwnerError("INVALID_INPUT", "The organization must be Active to restore access.");
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.studentMembership.update({
      where: { id: membershipId },
      data: { status: "ACTIVE", restoredAt: new Date() },
    });

    await tx.membershipHistoryEvent.create({
      data: { membershipId, eventType: "RESTORATION", performedByAccountId },
    });

    return updated;
  });
}

export async function updateGraduationInfo(
  membershipId: string,
  currentGrade: number,
  expectedGraduationYear: number,
) {
  const membership = await prisma.studentMembership.findUnique({ where: { id: membershipId } });
  if (!membership) throw new OwnerError("MEMBERSHIP_NOT_FOUND", "Membership not found.");

  return prisma.studentMembership.update({
    where: { id: membershipId },
    data: { currentGrade, expectedGraduationYear },
  });
}

// PRD-017 §10: may be triggered manually, ahead of the automatic July 1 cutoff.
export async function markGraduated(membershipId: string, performedByAccountId: string) {
  const membership = await prisma.studentMembership.findUnique({ where: { id: membershipId } });
  if (!membership) throw new OwnerError("MEMBERSHIP_NOT_FOUND", "Membership not found.");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.studentMembership.update({
      where: { id: membershipId },
      data: { status: "GRADUATED", graduatedAt: new Date() },
    });

    await tx.membershipHistoryEvent.create({
      data: { membershipId, eventType: "GRADUATION", performedByAccountId },
    });

    return updated;
  });
}

// PRD-017 §15: a dedicated student-facing transfer flow is out of scope — only
// the Owner can move a student between schools/districts, by updating the
// single membership row in place (studentId is unique: one row per student).
export async function resolveSchoolTransfer(
  membershipId: string,
  newOrganizationId: string,
  newSchoolId: string,
  newVerifiedSchoolEmail: string,
  performedByAccountId: string,
) {
  const membership = await prisma.studentMembership.findUnique({ where: { id: membershipId } });
  if (!membership) throw new OwnerError("MEMBERSHIP_NOT_FOUND", "Membership not found.");

  return prisma.$transaction(async (tx) => {
    const updated = await tx.studentMembership.update({
      where: { id: membershipId },
      data: {
        organizationId: newOrganizationId,
        schoolId: newSchoolId,
        verifiedSchoolEmail: newVerifiedSchoolEmail,
        status: "ACTIVE",
        restoredAt: new Date(),
      },
    });

    await tx.membershipHistoryEvent.create({
      data: {
        membershipId,
        eventType: "MANUAL_TRANSFER",
        performedByAccountId,
        previousOrganizationId: membership.organizationId,
        newOrganizationId,
      },
    });

    return updated;
  });
}

// Mirrors the same District-vs-School distinction as listOrganizations' counts:
// a District's memberships are everyone under the contract (organizationId); a
// School's are students actually at that school (schoolId) — not the same
// relation once a school belongs to a district.
/**
 * How many memberships the Owner organization page shows at once.
 *
 * It used to show all of them. That is fine for a pilot campus and unusable
 * for a district: two thousand memberships meant two thousand rows fetched
 * with the student joined and two thousand table rows rendered into the HTML,
 * on a page the Owner opens to check a contract date. The Student Directory is
 * the surface built for working through a roster at length; this list is the
 * most recent arrivals plus a total.
 */
export const MEMBERSHIP_PAGE_SIZE = 50;

export async function listMemberships(
  organizationId: string,
  { limit = MEMBERSHIP_PAGE_SIZE }: { limit?: number } = {},
) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new OwnerError("ORGANIZATION_NOT_FOUND", "Organization not found.");

  const where =
    org.organizationType === "DISTRICT" ? { organizationId } : { schoolId: organizationId };
  const [entries, total] = await Promise.all([
    prisma.studentMembership.findMany({
      where,
      include: { student: { select: { id: true, firstName: true, email: true } } },
      orderBy: { activatedAt: "desc" },
      take: limit,
    }),
    prisma.studentMembership.count({ where }),
  ]);
  return { entries, total };
}
