/**
 * Pure domain-matching rules for district auto-enrollment. No Prisma here —
 * `enrollment.ts` does the fetching and writing, this file decides. Kept
 * separate so every branch is directly unit-testable (CLAUDE.md: anything
 * state-machine-like needs tests covering the rules, not just the happy path).
 */

/** The lowercased domain of an email, or null if it isn't one address. */
export function domainOf(rawEmail: string): string | null {
  const email = rawEmail.trim().toLowerCase();
  // exactly one "@", and something on each side
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1) return null;
  const domain = email.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return null;
  return domain;
}

export type OrganizationShape = {
  id: string;
  officialName: string;
  organizationType: "SCHOOL" | "DISTRICT";
  status: string;
  contractStartDate: Date;
  contractEndDate: Date;
  /** Campuses under a DISTRICT; empty for a standalone SCHOOL. */
  schools: { id: string; officialName: string }[];
};

export type PartnerResolution =
  /** The email's domain belongs to no active partner. */
  | { kind: "NO_PARTNER" }
  /** Matched, but the contract isn't live — enrolling would grant nothing. */
  | { kind: "NOT_LIVE"; reason: "STATUS" | "BEFORE_CONTRACT" | "AFTER_CONTRACT" }
  /** Unambiguous: exactly one campus this student can belong to. */
  | { kind: "READY"; organizationId: string; schoolId: string; officialName: string }
  /** A district with several campuses — we can't guess which one. */
  | { kind: "NEEDS_CAMPUS"; organizationId: string; officialName: string };

/**
 * Decides whether an email's matched organization can be auto-enrolled into.
 *
 * `StudentMembership.schoolId` is non-nullable and always resolves to one
 * specific campus (PRD-017 §3), so auto-enrollment is only possible when the
 * campus is unambiguous. A multi-campus district falls back to the
 * school-email verification flow, which already asks the student to pick —
 * deliberately, rather than guessing a campus and quietly corrupting the
 * per-school aggregates the Administrator area reports on.
 */
export function resolvePartner(
  org: OrganizationShape | null,
  now: Date = new Date(),
): PartnerResolution {
  if (!org) return { kind: "NO_PARTNER" };
  if (org.status !== "ACTIVE") return { kind: "NOT_LIVE", reason: "STATUS" };
  // Same contract-window rule as the entitlement service, checked here too:
  // creating a membership that `hasActiveSchoolEntitlement` would reject is
  // worse than not creating one, because the student then looks enrolled and
  // still can't use anything.
  if (org.contractStartDate > now) return { kind: "NOT_LIVE", reason: "BEFORE_CONTRACT" };
  if (org.contractEndDate <= now) return { kind: "NOT_LIVE", reason: "AFTER_CONTRACT" };

  if (org.organizationType === "SCHOOL") {
    return { kind: "READY", organizationId: org.id, schoolId: org.id, officialName: org.officialName };
  }
  if (org.schools.length === 1) {
    return {
      kind: "READY",
      organizationId: org.id,
      schoolId: org.schools[0].id,
      officialName: org.schools[0].officialName,
    };
  }
  return { kind: "NEEDS_CAMPUS", organizationId: org.id, officialName: org.officialName };
}
