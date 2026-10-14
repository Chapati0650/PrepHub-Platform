import { prisma } from "@/lib/prisma";
import { getAccessContext, invalidateAccessContext } from "@/lib/entitlements";
import { computeExpectedGraduationYear, gradeFromGraduationYear } from "@/lib/school-verification/graduation-year";
import { contractState, domainOf, resolvePartner, type OrganizationShape, type PartnerResolution } from "@/lib/district/partner";

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
  | "NOT_ON_ROSTER"
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
let domainCache: { domains: Set<string>; anyRoster: boolean; loadedAt: number } | null = null;

async function getPartnerIndex(): Promise<{ domains: Set<string>; anyRoster: boolean }> {
  if (domainCache && Date.now() - domainCache.loadedAt < DOMAIN_CACHE_TTL_MS) return domainCache;
  const [rows, rosterCount] = await Promise.all([
    prisma.organizationDomain.findMany({ where: { isActive: true }, select: { domain: true } }),
    // Only "does any roster exist at all", never the entries themselves — a
    // district roster can run to thousands of rows and has no business being
    // held in memory on every serverless instance.
    prisma.schoolRosterEntry.count({ where: { removedAt: null }, take: 1 }),
  ]);
  domainCache = {
    domains: new Set(rows.map((r) => r.domain.trim().toLowerCase())),
    anyRoster: rosterCount > 0,
    loadedAt: Date.now(),
  };
  return domainCache;
}

export async function getActivePartnerDomains(): Promise<Set<string>> {
  return (await getPartnerIndex()).domains;
}

/**
 * Cheap pre-check: is this address worth a full eligibility lookup?
 *
 * True when the domain belongs to a partner, or when any roster exists at all
 * — a district may roster addresses that aren't on its own domain, and those
 * can only be found by querying. When no district has uploaded a roster (the
 * situation today) this stays a pure in-memory check and individual students
 * pay nothing for it.
 */
export async function isDistrictCandidateEmail(rawEmail: string | null | undefined): Promise<boolean> {
  if (!rawEmail) return false;
  const domain = domainOf(rawEmail);
  if (!domain) return false;
  const index = await getPartnerIndex();
  return index.domains.has(domain) || index.anyRoster;
}


/** Test seam — the module-level cache would otherwise leak between cases. */
export function __resetPartnerDomainCache(): void {
  domainCache = null;
}

/**
 * Enrols a student who became eligible after their account already existed —
 * their district signed up, or they were added to its roster.
 *
 * Called from the app layout so it runs before anything reads the entitlement,
 * and returns the one outcome a caller needs to act on. Costs nothing in the
 * common case: a student who already has a membership or a subscription is
 * dismissed from the cached access context without a query, and an address on
 * no partner domain is rejected from an in-memory set.
 */
export async function catchUpDistrictEnrollment(userId: string): Promise<EnrollmentOutcome> {
  const { user, subscription, membership } = await getAccessContext(userId);
  if (membership) return "ALREADY_MEMBER";
  if (subscription) return "NO_PARTNER";
  if (!(await isDistrictCandidateEmail(user?.email))) return "NO_PARTNER";
  const outcome = await ensureDistrictMembership(userId);
  // The access context was read before the membership existed, so anything
  // reading it later in this same render would still see an unenrolled
  // student — the bug this function exists to prevent.
  if (outcome === "CREATED") invalidateAccessContext(userId);
  return outcome;
}

/**
 * Looks for a district-supplied roster entry matching this email.
 *
 * This is the authoritative rule and runs before the domain rule: the roster
 * names the student's campus explicitly, which is what lets a multi-campus
 * district work at all (the domain rule has to defer there, because
 * `StudentMembership.schoolId` must resolve to exactly one campus).
 */
export async function lookupRosterEntry(rawEmail: string, now: Date = new Date()) {
  const email = rawEmail.trim().toLowerCase();
  const entry = await prisma.schoolRosterEntry.findFirst({
    where: { email, removedAt: null },
    include: { organization: true },
  });
  if (!entry) return null;
  const contract = contractState(entry.organization, now);
  return { entry, contract };
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

  // The roster is checked first: it is the district's own statement about who
  // is eligible, and it names the campus, so it answers more precisely than a
  // domain ever can.
  const roster = await lookupRosterEntry(user.email);
  let target: { organizationId: string; schoolId: string; via: "ROSTER" | "DOMAIN_MATCH"; graduationYear?: number | null };

  if (roster) {
    if (roster.contract !== "LIVE") return "NOT_LIVE";
    target = {
      organizationId: roster.entry.organizationId,
      schoolId: roster.entry.schoolId,
      via: "ROSTER",
      graduationYear: roster.entry.graduationYear,
    };
  } else {
    const resolution = await lookupPartnerByEmail(user.email);
    if (resolution.kind === "NO_PARTNER") return "NO_PARTNER";
    if (resolution.kind === "NOT_LIVE") return "NOT_LIVE";
    if (resolution.kind === "NOT_ON_ROSTER") return "NOT_ON_ROSTER";
    if (resolution.kind === "NEEDS_CAMPUS") return "NEEDS_CAMPUS";
    target = { organizationId: resolution.organizationId, schoolId: resolution.schoolId, via: "DOMAIN_MATCH" };
  }

  // Everything past here is about whether we're allowed to act on the match.
  if (!user.emailVerified) return "NEEDS_EMAIL_VERIFICATION";
  // `currentGrade` is required on the membership. Onboarding is what collects
  // it, so a brand-new account normally enrolls the moment onboarding
  // finishes — unless the roster already told us the graduation year, in
  // which case the district has answered it for us and the student can be
  // enrolled before they have answered anything.
  const grade = user.grade ?? gradeFromGraduationYear(target.graduationYear ?? null);
  if (grade == null) return "NO_GRADE";

  try {
    await prisma.studentMembership.create({
      data: {
        studentId: user.id,
        organizationId: target.organizationId,
        schoolId: target.schoolId,
        verifiedSchoolEmail: user.email.toLowerCase(),
        currentGrade: grade,
        expectedGraduationYear: target.graduationYear ?? computeExpectedGraduationYear(grade),
        status: "ACTIVE",
        activationMethod: target.via,
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
