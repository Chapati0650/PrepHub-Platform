import type { CommunityGoalMetric } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { OwnerError } from "./errors";

export type CreateOrganizationInput = {
  organizationType: "SCHOOL" | "DISTRICT";
  officialName: string;
  city: string;
  state: string;
  schoolYear: string;
  contractStartDate: Date;
  contractEndDate: Date;
  parentDistrictId?: string; // only valid for SCHOOL — adds it under a District
};

function validateOrganizationInput(input: {
  organizationType: "SCHOOL" | "DISTRICT";
  contractStartDate: Date;
  contractEndDate: Date;
  parentDistrictId?: string;
}) {
  if (input.organizationType === "DISTRICT" && input.parentDistrictId) {
    throw new OwnerError("INVALID_INPUT", "A district cannot itself have a parent district.");
  }
  if (input.contractEndDate <= input.contractStartDate) {
    throw new OwnerError("INVALID_INPUT", "Contract end date must be after the start date.");
  }
}

// PRD-017 §6: begins in SETUP regardless of dates — the Owner must explicitly activate.
export async function createOrganization(input: CreateOrganizationInput) {
  validateOrganizationInput(input);
  return prisma.organization.create({
    data: { ...input, status: "SETUP", directoryVisible: true },
  });
}

export type UpdateOrganizationInput = {
  officialName: string;
  city: string;
  state: string;
  schoolYear: string;
  contractStartDate: Date;
  contractEndDate: Date;
  internalNotes?: string;
};

export async function updateOrganizationDetails(id: string, input: UpdateOrganizationInput) {
  const org = await prisma.organization.findUnique({ where: { id } });
  if (!org) throw new OwnerError("ORGANIZATION_NOT_FOUND", "Organization not found.");
  validateOrganizationInput({ ...input, organizationType: org.organizationType });

  return prisma.organization.update({ where: { id }, data: input });
}

// PRD-009 §7 — one active community goal per school. Districts don't get a
// School Community page, so only SCHOOL-type orgs may have one configured.
export type UpdateCommunityGoalInput = {
  communityGoalMetric: CommunityGoalMetric | null;
  communityGoalTarget: number | null;
};

export async function updateCommunityGoal(id: string, input: UpdateCommunityGoalInput) {
  const org = await prisma.organization.findUnique({ where: { id } });
  if (!org) throw new OwnerError("ORGANIZATION_NOT_FOUND", "Organization not found.");
  if (org.organizationType !== "SCHOOL") {
    throw new OwnerError("INVALID_INPUT", "Only schools can have a community goal.");
  }
  if (input.communityGoalMetric && (!input.communityGoalTarget || input.communityGoalTarget <= 0)) {
    throw new OwnerError("INVALID_INPUT", "Enter a goal target greater than zero.");
  }

  return prisma.organization.update({
    where: { id },
    data: {
      communityGoalMetric: input.communityGoalMetric,
      communityGoalTarget: input.communityGoalMetric ? input.communityGoalTarget : null,
    },
  });
}

// PRD-011 §9 — the Owner-established eligible student population for a
// school; Administrators can view it but never edit it directly. Districts
// don't get one — Registered PrepHub Students/Registration Percentage are
// Admin Overview metrics, and that page is scoped to a single SCHOOL org.
export async function updateTotalEnrollment(id: string, totalEnrollment: number | null) {
  const org = await prisma.organization.findUnique({ where: { id } });
  if (!org) throw new OwnerError("ORGANIZATION_NOT_FOUND", "Organization not found.");
  if (org.organizationType !== "SCHOOL") {
    throw new OwnerError("INVALID_INPUT", "Only schools have a Total School Enrollment.");
  }
  if (totalEnrollment !== null && totalEnrollment < 0) {
    throw new OwnerError("INVALID_INPUT", "Total School Enrollment cannot be negative.");
  }

  return prisma.organization.update({ where: { id }, data: { totalEnrollment } });
}

// PRD-017 §6: ACTIVE only once required data is complete, the contract start
// date has arrived, and the end date hasn't passed.
export async function activateOrganization(id: string) {
  const org = await prisma.organization.findUnique({ where: { id } });
  if (!org) throw new OwnerError("ORGANIZATION_NOT_FOUND", "Organization not found.");

  const now = new Date();
  if (org.contractStartDate > now) {
    throw new OwnerError("CONTRACT_NOT_STARTED", "The contract start date hasn't arrived yet.");
  }
  if (org.contractEndDate <= now) {
    throw new OwnerError("CONTRACT_EXPIRED", "The contract end date has already passed.");
  }

  return prisma.organization.update({ where: { id }, data: { status: "ACTIVE" } });
}

// PRD-017 §16.3: immediately disables school-funded access; preserves data.
export async function suspendOrganization(id: string) {
  const org = await prisma.organization.findUnique({ where: { id } });
  if (!org) throw new OwnerError("ORGANIZATION_NOT_FOUND", "Organization not found.");
  return prisma.organization.update({ where: { id }, data: { status: "SUSPENDED" } });
}

// PRD-017 §5: retained for history, no longer operational.
export async function archiveOrganization(id: string) {
  const org = await prisma.organization.findUnique({ where: { id } });
  if (!org) throw new OwnerError("ORGANIZATION_NOT_FOUND", "Organization not found.");
  return prisma.organization.update({
    where: { id },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });
}

// PRD-017 §16.4: previously-Active memberships regain access automatically once
// the org is ACTIVE again — that's derived from org+membership status at read
// time (see src/lib/entitlements.ts), not something this needs to touch.
export async function renewOrganization(id: string, contractStartDate: Date, contractEndDate: Date) {
  const org = await prisma.organization.findUnique({ where: { id } });
  if (!org) throw new OwnerError("ORGANIZATION_NOT_FOUND", "Organization not found.");
  if (contractEndDate <= contractStartDate) {
    throw new OwnerError("INVALID_INPUT", "Contract end date must be after the start date.");
  }

  const now = new Date();
  const status = contractStartDate <= now && contractEndDate > now ? "ACTIVE" : "SETUP";
  return prisma.organization.update({
    where: { id },
    data: { contractStartDate, contractEndDate, status },
  });
}

export type OrganizationListRow = {
  id: string;
  officialName: string;
  organizationType: "SCHOOL" | "DISTRICT";
  status: string;
  contractStartDate: Date;
  contractEndDate: Date;
  updatedAt: Date;
  activeStudentCount: number;
  administratorCount: number;
};

// PRD-017 §18: the Owner Schools page table. No seat-limit column/data — V1
// has no licensed-seat concept at all (§11).
export async function listOrganizations(): Promise<OrganizationListRow[]> {
  const orgs = await prisma.organization.findMany({ orderBy: { officialName: "asc" } });

  return Promise.all(
    orgs.map(async (org) => {
      // A District's "active students" is everyone under the district contract
      // (organizationId), regardless of which of its schools they attend. A
      // School's is students actually AT that school (schoolId) — for a school
      // that belongs to a district, those aren't the same relation.
      const activeStudentCount =
        org.organizationType === "DISTRICT"
          ? await prisma.studentMembership.count({
              where: { organizationId: org.id, status: "ACTIVE" },
            })
          : await prisma.studentMembership.count({
              where: { schoolId: org.id, status: "ACTIVE" },
            });

      const administratorCount = await prisma.administratorAssignment.count({
        where: { organizationId: org.id, removedAt: null },
      });

      return {
        id: org.id,
        officialName: org.officialName,
        organizationType: org.organizationType,
        status: org.status,
        contractStartDate: org.contractStartDate,
        contractEndDate: org.contractEndDate,
        updatedAt: org.updatedAt,
        activeStudentCount,
        administratorCount,
      };
    }),
  );
}

// For the "resolve exceptional school transfer" picker (PRD-017 §15) — every
// SCHOOL org is a valid transfer target, whether standalone or under a
// District, since a membership's organizationId always resolves to a District
// or a standalone School but schoolId always resolves to one specific School.
export async function listAllSchools() {
  return prisma.organization.findMany({
    where: { organizationType: "SCHOOL", status: { not: "ARCHIVED" } },
    select: { id: true, officialName: true, parentDistrictId: true },
    orderBy: { officialName: "asc" },
  });
}

export async function getOrganizationDetail(id: string) {
  const org = await prisma.organization.findUnique({
    where: { id },
    include: {
      schools: { orderBy: { officialName: "asc" } },
      domains: true,
      administratorAssigns: {
        where: { removedAt: null },
        include: { user: { select: { id: true, firstName: true, email: true } } },
      },
    },
  });
  if (!org) throw new OwnerError("ORGANIZATION_NOT_FOUND", "Organization not found.");
  return org;
}
