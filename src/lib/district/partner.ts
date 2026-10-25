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
  /** DOMAIN | ROSTER | ROSTER_OR_DOMAIN — who the organization lets in. */
  enrollmentMode?: string;
  /** Campuses under a DISTRICT; empty for a standalone SCHOOL. */
  schools: { id: string; officialName: string }[];
};

/**
 * Is the organization's contract live right now? Separated out because both
 * eligibility rules need it and neither should be able to drift from the
 * entitlement service's view of the same window.
 */
export function contractState(
  org: Pick<OrganizationShape, "status" | "contractStartDate" | "contractEndDate">,
  now: Date,
): "LIVE" | "STATUS" | "BEFORE_CONTRACT" | "AFTER_CONTRACT" {
  if (org.status !== "ACTIVE") return "STATUS";
  if (org.contractStartDate > now) return "BEFORE_CONTRACT";
  if (org.contractEndDate <= now) return "AFTER_CONTRACT";
  return "LIVE";
}

/** Does this organization still admit students by email domain alone? */
export function domainEnrollmentAllowed(org: Pick<OrganizationShape, "enrollmentMode">): boolean {
  // Undefined means a row loaded before the column existed — treat as DOMAIN,
  // which is the column's own default, so behaviour can't change under anyone.
  const mode = org.enrollmentMode ?? "DOMAIN";
  return mode === "DOMAIN" || mode === "ROSTER_OR_DOMAIN";
}

export type PartnerResolution =
  /** The email's domain belongs to no active partner. */
  | { kind: "NO_PARTNER" }
  /** Matched, but the contract isn't live — enrolling would grant nothing. */
  | { kind: "NOT_LIVE"; reason: "STATUS" | "BEFORE_CONTRACT" | "AFTER_CONTRACT" }
  /**
   * The domain belongs to a partner that admits students by roster only, and
   * this person isn't on it. Distinct from NO_PARTNER so the student can be
   * told something true — their school uses PrepHub, they just aren't on the
   * list yet — instead of a flat "no".
   */
  | { kind: "NOT_ON_ROSTER"; officialName: string }
  /** Unambiguous: exactly one campus this student can belong to. */
  | { kind: "READY"; organizationId: string; schoolId: string; officialName: string }
  /**
   * A district with several campuses: we can't guess which one, so the
   * student is asked. `campuses` is what they choose from — empty only for a
   * district whose campuses haven't been set up yet.
   */
  | {
      kind: "NEEDS_CAMPUS";
      organizationId: string;
      officialName: string;
      campuses: { id: string; officialName: string }[];
    };

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
  // Same contract-window rule as the entitlement service, checked here too:
  // creating a membership that `hasActiveSchoolEntitlement` would reject is
  // worse than not creating one, because the student then looks enrolled and
  // still can't use anything.
  const contract = contractState(org, now);
  if (contract !== "LIVE") return { kind: "NOT_LIVE", reason: contract };

  // A roster-only organization has said its roster is the whole answer, so a
  // matching email suffix is not enough on its own.
  if (!domainEnrollmentAllowed(org)) return { kind: "NOT_ON_ROSTER", officialName: org.officialName };

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
  return {
    kind: "NEEDS_CAMPUS",
    organizationId: org.id,
    officialName: org.officialName,
    campuses: org.schools.map((s) => ({ id: s.id, officialName: s.officialName })),
  };
}
