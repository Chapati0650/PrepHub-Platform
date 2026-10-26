import type { OrganizationStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Whether a school's students have Premium through it right now, as an
 * administrator should read it.
 *
 * The state comes from the organization that *pays* — the district for a
 * campus under one, the school itself when it stands alone — because that is
 * the row the entitlement service reads (`hasActiveSchoolEntitlement` checks
 * `membership.organization`, which is the district for a district student).
 * A campus row gets its status and dates copied from the district once, when
 * it's added, and nothing keeps them in step after that: activating,
 * suspending or renewing the district never touches its campuses. So the
 * campus row said "Being set up" while its students already had Premium, or
 * "Active" with last year's end date.
 *
 * And "Ended" once the end date has passed, whatever the status says: the
 * entitlement check judges the dates directly (no job flips an expired
 * contract's status), so a lapsed contract still marked ACTIVE has already
 * stopped granting Premium, and must not be described as granting it.
 */
export type SchoolAccessState = "ACTIVE" | "NOT_STARTED" | "ENDED" | "PAUSED" | "CLOSED";

type ContractRow = { status: OrganizationStatus; contractStartDate: Date; contractEndDate: Date };

/**
 * Pure. "ACTIVE" here is exactly when `hasActiveSchoolEntitlement` grants an
 * enrolled, not-yet-graduated student access: status ACTIVE, the start date
 * reached, the end date not. The other four only say *why* not, in the words
 * the admin pages use. access-info.test.ts holds the two rules side by side.
 */
export function schoolAccessState(org: ContractRow, now: Date = new Date()): SchoolAccessState {
  if (org.status === "ARCHIVED") return "CLOSED";
  if (org.status === "EXPIRED" || org.contractEndDate <= now) return "ENDED";
  if (org.status === "SUSPENDED") return "PAUSED";
  if (org.status === "SETUP" || org.contractStartDate > now) return "NOT_STARTED";
  return "ACTIVE";
}

export type SchoolAccessInfo = {
  schoolName: string;
  /** The district providing this campus's access, or null for a school that contracts on its own. */
  providedBy: string | null;
  state: SchoolAccessState;
  contractStartDate: Date;
  contractEndDate: Date;
};

// PRD-011 §19 — deliberately just enough to answer "is access currently
// active, and for how long" — no contract amount, invoices, or other
// billing/contract-management detail (§19's explicit non-goals).
export async function getSchoolAccessInfo(schoolId: string, now: Date = new Date()): Promise<SchoolAccessInfo> {
  const contract = { status: true, contractStartDate: true, contractEndDate: true } as const;
  const school = await prisma.organization.findUniqueOrThrow({
    where: { id: schoolId },
    select: { officialName: true, ...contract, parentDistrict: { select: { officialName: true, ...contract } } },
  });
  const paying = school.parentDistrict ?? school;
  return {
    schoolName: school.officialName,
    providedBy: school.parentDistrict?.officialName ?? null,
    state: schoolAccessState(paying, now),
    contractStartDate: paying.contractStartDate,
    contractEndDate: paying.contractEndDate,
  };
}

/**
 * A contract date as the Owner typed it. The Owner's form stores a bare date
 * as midnight UTC, so it is formatted in UTC: in the school's own zone that
 * midnight is the evening before, and "Ends May 30" for a contract typed as
 * May 31 is a day short.
 */
export function formatContractDate(date: Date, style: "long" | "month" = "long"): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    ...(style === "long" ? { day: "numeric" } : {}),
    timeZone: "UTC",
  });
}
