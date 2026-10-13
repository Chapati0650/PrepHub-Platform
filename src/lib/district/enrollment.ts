import { prisma } from "@/lib/prisma";
import { computeExpectedGraduationYear } from "@/lib/school-verification/graduation-year";
import { domainOf, resolvePartner, type OrganizationShape, type PartnerResolution } from "@/lib/district/partner";

/**
 * District auto-enrollment: a student whose *own* account email is on a
 * partner district's verified domain gets school access without a separate
 * verification round-trip.
 *
 * Why this exists: the school-email flow (PRD-002) asks a student to sign up,
 * find /access, type a second email, wait for a message and click a link —
 * six steps for the population least likely to complete any of them. When the
 * account email is already the school email, the domain itself is the proof,
 * so none of those steps are needed.
 *
 * **The email must be verified.** Google sign-in sets `emailVerified`, so a
 * district Google Workspace account is proof of enrolment. Credentials signup
 * verifies nothing — anyone could type `someone@district.org` — so that path
 * still goes through the emailed link. The check below is on `emailVerified`,
 * not on the domain alone, and that distinction is the whole security model.
 */

export type EnrollmentOutcome =
  | "CREATED"
  | "ALREADY_MEMBER"
  | "NO_PARTNER"
  | "NOT_LIVE"
  | "NEEDS_CAMPUS"
  | "NEEDS_EMAIL_VERIFICATION"
  | "NO_GRADE";

/**
 * The set of active partner domains, cached in-process for a short window.
 *
 * This exists purely so the dashboard can ask "is this student's email even
 * a district address?" without a database round trip. Without it, every
 * render for every individual student would pay a lookup to discover the
 * answer is no — which at a few thousand students is the kind of per-render
 * cost that compounds. Partner domains change when the Owner edits a school,
 * which is rare, so a stale minute is harmless; a brand-new domain simply
 * starts auto-enrolling up to TTL later.
 */
const DOMAIN_CACHE_TTL_MS = 60_000;
let domainCache: { domains: Set<string>; loadedAt: number } | null = null;

export async function getActivePartnerDomains(): Promise<Set<string>> {
  if (domainCache && Date.now() - domainCache.loadedAt < DOMAIN_CACHE_TTL_MS) {
    return domainCache.domains;
  }
  const rows = await prisma.organizationDomain.findMany({
    where: { isActive: true },
    select: { domain: true },
  });
  const domains = new Set(rows.map((r) => r.domain.trim().toLowerCase()));
  domainCache = { domains, loadedAt: Date.now() };
  return domains;
}

/** Cheap pre-check: is this address even worth a partner lookup? */
export async function isPartnerDomainEmail(rawEmail: string | null | undefined): Promise<boolean> {
  if (!rawEmail) return false;
  const domain = domainOf(rawEmail);
  if (!domain) return false;
  return (await getActivePartnerDomains()).has(domain);
}

/** Test seam — the module-level cache would otherwise leak between cases. */
export function __resetPartnerDomainCache(): void {
  domainCache = null;
}

/** Looks up the partner organization that owns an email's domain. */
export async function lookupPartnerByEmail(rawEmail: string, now: Date = new Date()): Promise<PartnerResolution> {
  const domain = domainOf(rawEmail);
  if (!domain) return { kind: "NO_PARTNER" };

  const record = await prisma.organizationDomain.findFirst({
    where: { domain: { equals: domain, mode: "insensitive" }, isActive: true },
    include: { organization: { include: { schools: { select: { id: true, officialName: true } } } } },
  });
  if (!record) return { kind: "NO_PARTNER" };

  const org = record.organization as unknown as OrganizationShape;
  return resolvePartner(org, now);
}

/**
 * Idempotent. Creates the student's `StudentMembership` when their verified
 * account email is on an active partner domain and the campus is unambiguous.
 * Safe to call on every dashboard render: it returns early for the common
 * cases (already a member, or an email on no partner domain).
 *
 * Returns why nothing happened when it didn't, so callers can surface the one
 * actionable case (`NEEDS_EMAIL_VERIFICATION`) and ignore the rest.
 */
export async function ensureDistrictMembership(userId: string): Promise<EnrollmentOutcome> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerified: true, grade: true, role: true },
  });
  if (!user?.email || user.role !== "STUDENT") return "NO_PARTNER";

  const existing = await prisma.studentMembership.findUnique({ where: { studentId: userId } });
  if (existing) return "ALREADY_MEMBER";

  const resolution = await lookupPartnerByEmail(user.email);
  if (resolution.kind === "NO_PARTNER") return "NO_PARTNER";
  if (resolution.kind === "NOT_LIVE") return "NOT_LIVE";
  if (resolution.kind === "NEEDS_CAMPUS") return "NEEDS_CAMPUS";

  // The domain matches a live partner. Everything past here is about whether
  // we're allowed to act on it yet.
  if (!user.emailVerified) return "NEEDS_EMAIL_VERIFICATION";
  // `currentGrade` is required on the membership and onboarding is what
  // collects it, so a brand-new account enrolls the moment onboarding
  // finishes rather than at signup.
  if (user.grade == null) return "NO_GRADE";

  try {
    await prisma.studentMembership.create({
      data: {
        studentId: user.id,
        organizationId: resolution.organizationId,
        schoolId: resolution.schoolId,
        verifiedSchoolEmail: user.email.toLowerCase(),
        currentGrade: user.grade,
        expectedGraduationYear: computeExpectedGraduationYear(user.grade),
        status: "ACTIVE",
        activationMethod: "DOMAIN_MATCH",
      },
    });
    return "CREATED";
  } catch {
    // Two concurrent renders can race to create the same membership; the
    // unique constraint on studentId is what actually enforces "at most one",
    // and losing that race is a success from the caller's point of view.
    const now = await prisma.studentMembership.findUnique({ where: { studentId: userId } });
    return now ? "ALREADY_MEMBER" : "NO_PARTNER";
  }
}

/**
 * True when this email's domain belongs to a live partner — used to decide
 * whether to show pricing at all. A student who arrived through their
 * district must never be shown an upgrade prompt (PRD-011 §19 non-goals, and
 * the Owner's own rule that district students see no pricing).
 */
export async function emailIsOnPartnerDomain(rawEmail: string): Promise<boolean> {
  const r = await lookupPartnerByEmail(rawEmail);
  return r.kind === "READY" || r.kind === "NEEDS_CAMPUS";
}
