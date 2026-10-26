import { prisma } from "@/lib/prisma";
import { getAccessContext, invalidateAccessContext } from "@/lib/entitlements";
import { computeExpectedGraduationYear, gradeFromGraduationYear } from "@/lib/school-verification/graduation-year";
import { contractState, domainOf, resolvePartner, type OrganizationShape, type PartnerResolution } from "@/lib/district/partner";

/**
 * District auto-enrollment: a student whose *own* account email is on a
 * partner district's verified domain (or on its roster) gets school access
 * without a separate verification round-trip.
 *
 * Why this exists: the school-email flow (PRD-002) asks a student to sign up,
 * find /access, type a second email, wait for a message and click a link —
 * six steps for the population least likely to complete any of them. When the
 * account email is already the school email, the domain itself is the proof,
 * so none of those steps are needed.
 *
 * **The email must be verified.** Google sign-in sets `emailVerified`, so a
 * district Google Workspace account is proof of enrolment. Credentials signup
 * verifies nothing — anyone could type `someone@district.org` — so a password
 * account is sent one confirmation link to its own address
 * (`./email-verification.ts`), and confirming it is what sets the field. The
 * check below is on `emailVerified`, not on the domain alone, and that
 * distinction is the whole security model.
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
 * What a district has said about one email address, before anything is
 * written. The roster is consulted first, then the domain.
 */
export type DistrictMatch =
  /** Neither on a roster nor on a partner domain. */
  | { kind: "NONE" }
  /** Matched an organization whose contract isn't live — enrolling would grant nothing. */
  | { kind: "NOT_LIVE" }
  /** A roster-only partner owns the domain, and this address isn't on its roster. */
  | { kind: "NOT_ON_ROSTER"; organizationName: string }
  /** Exactly one campus this address belongs to. */
  | {
      kind: "MATCH";
      via: "ROSTER" | "DOMAIN_MATCH";
      organizationId: string;
      organizationName: string;
      schoolId: string;
      schoolName: string;
      graduationYear: number | null;
    }
  /** A multi-campus district matched by domain: the student has to say which school. */
  | {
      kind: "NEEDS_CAMPUS";
      organizationId: string;
      organizationName: string;
      campuses: { id: string; officialName: string }[];
    };

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

async function getPartnerIndex(): Promise<{ domains: Set<string>; anyRoster: boolean; loadedAt: number }> {
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

/**
 * Addresses found to match no district, each with the partner index load it
 * was checked against (see catchUpDistrictEnrollment). Per instance, bounded,
 * and simply cleared when full: losing it costs one lookup, never a wrong answer.
 */
const NO_MATCH_CACHE_LIMIT = 20_000;
const noMatchUnderIndex = new Map<string, number>();

function rememberNoMatch(address: string, indexLoadedAt: number): void {
  if (noMatchUnderIndex.size >= NO_MATCH_CACHE_LIMIT) noMatchUnderIndex.clear();
  noMatchUnderIndex.set(address, indexLoadedAt);
}

export async function getActivePartnerDomains(): Promise<Set<string>> {
  return (await getPartnerIndex()).domains;
}

/**
 * Cheap pre-check: is this address worth a full eligibility lookup?
 *
 * True when the domain belongs to a partner, or when any roster exists at all
 * — a district may roster addresses that aren't on its own domain, and those
 * can only be found by querying. When no district has uploaded a roster this
 * stays a pure in-memory check and individual students pay nothing for it.
 *
 * A *candidate*, not a match: with any roster uploaded this is true for every
 * address, so it must never decide what a student is told. `findDistrictMatch`
 * is the answer; this only decides whether asking is worth a query.
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
  noMatchUnderIndex.clear();
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
    include: { organization: true, school: { select: { officialName: true } } },
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
    include: {
      organization: {
        include: {
          // An archived campus is gone: it can't be enrolled into, and it
          // mustn't make a one-campus district look like it has two.
          schools: {
            where: { status: { not: "ARCHIVED" } },
            select: { id: true, officialName: true },
            orderBy: { officialName: "asc" },
          },
        },
      },
    },
  });
  if (!record) return { kind: "NO_PARTNER" };

  const org = record.organization as unknown as OrganizationShape;
  return resolvePartner(org, now);
}

/** What the roster, then the domain, say about this address. Read-only. */
export async function findDistrictMatch(rawEmail: string, now: Date = new Date()): Promise<DistrictMatch> {
  const roster = await lookupRosterEntry(rawEmail, now);
  if (roster) {
    if (roster.contract !== "LIVE") return { kind: "NOT_LIVE" };
    return {
      kind: "MATCH",
      via: "ROSTER",
      organizationId: roster.entry.organizationId,
      organizationName: roster.entry.organization.officialName,
      schoolId: roster.entry.schoolId,
      schoolName: roster.entry.school.officialName,
      graduationYear: roster.entry.graduationYear,
    };
  }

  const resolution = await lookupPartnerByEmail(rawEmail, now);
  switch (resolution.kind) {
    case "NO_PARTNER":
      return { kind: "NONE" };
    case "NOT_LIVE":
      return { kind: "NOT_LIVE" };
    case "NOT_ON_ROSTER":
      return { kind: "NOT_ON_ROSTER", organizationName: resolution.officialName };
    case "NEEDS_CAMPUS":
      return {
        kind: "NEEDS_CAMPUS",
        organizationId: resolution.organizationId,
        organizationName: resolution.officialName,
        campuses: resolution.campuses,
      };
    case "READY":
      return {
        kind: "MATCH",
        via: "DOMAIN_MATCH",
        organizationId: resolution.organizationId,
        // For a district, READY carries the one campus's name; the district's
        // own name isn't on the resolution, and the campus is what a student
        // recognises anyway.
        organizationName: resolution.officialName,
        schoolId: resolution.schoolId,
        schoolName: resolution.officialName,
        graduationYear: null,
      };
  }
}

/**
 * Idempotent. Creates the student's `StudentMembership` when their verified
 * account email is on a partner's roster or active domain and the campus is
 * known. Safe to call on every render: it returns early for the common cases
 * (already a member, or an email on no partner domain).
 *
 * `schoolId` answers NEEDS_CAMPUS: a multi-campus district matched by domain
 * can't tell us the campus, so the student picks one, and it is accepted only
 * if it is one of that district's own campuses.
 *
 * Returns why nothing happened when it didn't, so callers can surface the
 * actionable cases (`NEEDS_EMAIL_VERIFICATION`, `NEEDS_CAMPUS`) and ignore the
 * rest.
 */
export async function ensureDistrictMembership(
  userId: string,
  options: { schoolId?: string } = {},
): Promise<EnrollmentOutcome> {
  return (await enroll(userId, options)).outcome;
}

async function enroll(
  userId: string,
  options: { schoolId?: string },
): Promise<{ outcome: EnrollmentOutcome; match: DistrictMatch | null; email: string | null }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerified: true, grade: true, role: true },
  });
  if (!user?.email || user.role !== "STUDENT") return { outcome: "NO_PARTNER", match: null, email: null };

  const existing = await prisma.studentMembership.findUnique({ where: { studentId: userId } });
  if (existing) return { outcome: "ALREADY_MEMBER", match: null, email: user.email };

  const match = await findDistrictMatch(user.email);
  const result = (outcome: EnrollmentOutcome) => ({ outcome, match, email: user.email });
  if (match.kind === "NONE") return result("NO_PARTNER");
  if (match.kind === "NOT_LIVE") return result("NOT_LIVE");
  if (match.kind === "NOT_ON_ROSTER") return result("NOT_ON_ROSTER");

  // Everything past here is about whether we're allowed to act on the match.
  // Checked before the campus question on purpose: an unverified address is
  // asked to confirm first, and the confirmation page asks for the campus in
  // the same step, so nobody is asked a question they then can't act on.
  if (!user.emailVerified) return result("NEEDS_EMAIL_VERIFICATION");

  let target: { organizationId: string; schoolId: string; via: "ROSTER" | "DOMAIN_MATCH"; graduationYear: number | null };
  if (match.kind === "NEEDS_CAMPUS") {
    const campus = match.campuses.find((c) => c.id === options.schoolId);
    if (!campus) return result("NEEDS_CAMPUS");
    target = { organizationId: match.organizationId, schoolId: campus.id, via: "DOMAIN_MATCH", graduationYear: null };
  } else {
    target = match;
  }

  // `currentGrade` is required on the membership. Onboarding is what collects
  // it, so a brand-new account normally enrolls the moment onboarding
  // finishes — unless the roster already told us the graduation year, in
  // which case the district has answered it for us and the student can be
  // enrolled before they have answered anything.
  const grade = user.grade ?? gradeFromGraduationYear(target.graduationYear);
  if (grade == null) return result("NO_GRADE");

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
    return result("CREATED");
  } catch {
    // Two concurrent renders can race to create the same membership; the
    // unique constraint on studentId is what actually enforces "at most one",
    // and losing that race is a success from the caller's point of view.
    const now = await prisma.studentMembership.findUnique({ where: { studentId: userId } });
    return result(now ? "ALREADY_MEMBER" : "NO_PARTNER");
  }
}

/**
 * The one thing the app shell tells a student who is one step away from
 * their school's access. Each kind names the organization, so the message is
 * specific rather than "your school might provide this".
 */
export type DistrictPrompt =
  | { kind: "CONFIRM_EMAIL"; organizationName: string; email: string }
  | { kind: "PICK_CAMPUS"; organizationName: string }
  | { kind: "NOT_ON_ROSTER"; organizationName: string; email: string };

function promptFor(outcome: EnrollmentOutcome, match: DistrictMatch | null, email: string | null): DistrictPrompt | null {
  if (!match || !email) return null;
  const organizationName =
    match.kind === "MATCH" || match.kind === "NEEDS_CAMPUS" || match.kind === "NOT_ON_ROSTER"
      ? match.organizationName
      : null;
  if (!organizationName) return null;
  if (outcome === "NEEDS_EMAIL_VERIFICATION") return { kind: "CONFIRM_EMAIL", organizationName, email };
  if (outcome === "NEEDS_CAMPUS") return { kind: "PICK_CAMPUS", organizationName };
  if (outcome === "NOT_ON_ROSTER") return { kind: "NOT_ON_ROSTER", organizationName, email };
  return null;
}

export type DistrictCatchUp = { outcome: EnrollmentOutcome; prompt: DistrictPrompt | null };

/**
 * Enrols a student who became eligible after their account already existed —
 * their district signed up, they were added to its roster, or they just
 * confirmed their email — and says what, if anything, they still need to do.
 *
 * Called from the app layout so it runs before anything reads the entitlement.
 * Costs nothing in the common case: a student who already has a membership or
 * a subscription is dismissed from the cached access context without a query,
 * and an address on no partner domain is rejected from an in-memory set.
 */
export async function catchUpDistrictEnrollment(userId: string): Promise<DistrictCatchUp> {
  const { user, subscription, membership } = await getAccessContext(userId);
  if (membership) return { outcome: "ALREADY_MEMBER", prompt: null };
  if (subscription) return { outcome: "NO_PARTNER", prompt: null };
  if (!user?.email || !(await isDistrictCandidateEmail(user.email))) return { outcome: "NO_PARTNER", prompt: null };

  // Once any district has uploaded a roster, every address is a candidate, so
  // without this every render for every free student repeated the same
  // roster and domain lookups to learn, again, that they match nothing. The
  // answer is remembered against the partner index it was found under, so a
  // new roster or domain is noticed as soon as the index reloads (a minute at
  // most), exactly as stale as the pre-check above already is.
  const index = await getPartnerIndex();
  const address = user.email.trim().toLowerCase();
  if (noMatchUnderIndex.get(address) === index.loadedAt) return { outcome: "NO_PARTNER", prompt: null };

  const { outcome, match, email } = await enroll(userId, {});
  if (match?.kind === "NONE") rememberNoMatch(address, index.loadedAt);
  // The access context was read before the membership existed, so anything
  // reading it later in this same render would still see an unenrolled
  // student — the bug this function exists to prevent.
  if (outcome === "CREATED") invalidateAccessContext(userId);
  return { outcome, prompt: promptFor(outcome, match, email) };
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
