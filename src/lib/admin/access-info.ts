import type { OrganizationStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type SchoolAccessInfo = {
  schoolName: string;
  status: OrganizationStatus;
  contractStartDate: Date;
  contractEndDate: Date;
};

// PRD-011 §19 — deliberately just enough to answer "is access currently
// active, and for how long" — no contract amount, invoices, or other
// billing/contract-management detail (§19's explicit non-goals).
export async function getSchoolAccessInfo(schoolId: string): Promise<SchoolAccessInfo> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: schoolId } });
  return {
    schoolName: org.officialName,
    status: org.status,
    contractStartDate: org.contractStartDate,
    contractEndDate: org.contractEndDate,
  };
}
