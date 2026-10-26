import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { scheduleSubscriptionNonRenewal } from "@/lib/billing";
import { SchoolVerificationError } from "./errors";
import { computeExpectedGraduationYear, gradeFromGraduationYear } from "./graduation-year";
import { domainEnrollmentAllowed } from "@/lib/district/partner";
import { lookupRosterEntry } from "@/lib/district/enrollment";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — PRD-002 §8.3 "configurable period"

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function domainOf(email: string): string {
  return email.slice(email.indexOf("@") + 1).toLowerCase();
}

/** PRD-002 §8.1: validate, match the domain, and email a single-use link. */
export async function requestSchoolVerification(studentId: string, rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();

  const [account, existingMembership, emailAlreadyLinked] = await Promise.all([
    prisma.user.findUnique({ where: { id: studentId }, select: { role: true, firstName: true } }),
    prisma.studentMembership.findUnique({ where: { studentId } }),
    prisma.studentMembership.findUnique({ where: { verifiedSchoolEmail: email } }),
  ]);

  // A membership is what puts someone in a school's figures, its leaderboard
  // and its announcement list. Staff accounts are kept out of all of those by
  // never having one (CLAUDE.md, Phase 6), which this path didn't enforce:
  // district enrollment checks the role, school-email verification didn't.
  if (account && account.role !== "STUDENT") {
    throw new SchoolVerificationError(
      "NOT_A_STUDENT",
      "School access connects to a student account. Staff accounts already have everything they need.",
    );
  }
  if (existingMembership) {
    throw new SchoolVerificationError(
      "ALREADY_HAS_MEMBERSHIP",
      "This account already has school-provided access connected.",
    );
  }
  if (emailAlreadyLinked) {
    throw new SchoolVerificationError(
      "SCHOOL_EMAIL_ALREADY_LINKED",
      "This school email is already connected to another PrepHub account.",
    );
  }

  const domainRecord = await prisma.organizationDomain.findFirst({
    where: { domain: { equals: domainOf(email), mode: "insensitive" }, isActive: true },
    include: { organization: true },
  });

  if (!domainRecord) {
    throw new SchoolVerificationError(
      "DOMAIN_NOT_PARTNER",
      "This email domain is not currently associated with a PrepHub partner.",
    );
  }
  if (domainRecord.organization.status !== "ACTIVE") {
    throw new SchoolVerificationError(
      "PARTNERSHIP_INACTIVE",
      "PrepHub access is no longer available through this school or district.",
    );
  }
  await requireOnRosterIfRosterOnly(domainRecord.organization, email);

  const rawToken = randomBytes(32).toString("hex");
  await prisma.schoolVerificationToken.create({
    data: {
      studentId,
      requestedEmail: email,
      matchedOrganizationId: domainRecord.organizationId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  // Addressed by name like every other email we send; a missing row simply
  // falls back to a neutral greeting.
  const student = account;

  const verifyUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/access/verify-school/${rawToken}`;
  await sendEmail({
    to: email,
    subject: "Verify your school email for PrepHub",
    text: `Hi ${student?.firstName ?? "there"},

Open the link below to verify your school email and switch on the PrepHub access your school provides. It expires in 24 hours and works once:

${verifyUrl}

If the link has expired by the time you get to it, request a new one from the access page and it'll send another. Any trouble, just reply to this.

— Prithvi, PrepHub`,
  });
}

/**
 * A roster-only organization has said its roster is the whole answer (see
 * district/partner.ts's `domainEnrollmentAllowed`). Auto-enrollment already
 * honoured that; this flow didn't, which made "verify a school email" a way
 * around the district's own list for anyone with an address on its domain.
 * Checked when the link is requested and again when it is used, since a
 * district can change its roster or its mode in between.
 */
async function requireOnRosterIfRosterOnly(
  organization: { officialName: string; enrollmentMode?: string | null },
  email: string,
) {
  if (domainEnrollmentAllowed({ enrollmentMode: organization.enrollmentMode ?? undefined })) return;
  if (await lookupRosterEntry(email)) return;
  throw new SchoolVerificationError(
    "NOT_ON_ROSTER",
    `${organization.officialName} uses PrepHub, but this email isn't on its student list yet. Ask your school counselor to add you, and your access will switch on.`,
  );
}

type ResolvedToken = {
  tokenId: string;
  studentId: string;
  organization: { id: string; officialName: string; organizationType: "SCHOOL" | "DISTRICT" };
  requiresSchoolSelection: boolean;
  schools: { id: string; officialName: string }[];
};

async function loadValidToken(rawToken: string) {
  const record = await prisma.schoolVerificationToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { matchedOrganization: { include: { schools: true } } },
  });

  if (!record) {
    throw new SchoolVerificationError("INVALID_TOKEN", "This verification link is invalid.");
  }
  if (record.completedAt) {
    throw new SchoolVerificationError(
      "ALREADY_COMPLETED",
      "This verification link has already been used.",
    );
  }
  if (record.expiresAt < new Date()) {
    throw new SchoolVerificationError(
      "EXPIRED_TOKEN",
      "This verification link has expired.",
    );
  }

  return record;
}

/** Read-only: lets the confirmation page render the right UI (auto-complete
 *  vs. "pick your school") without consuming the token. */
export async function resolveVerificationToken(rawToken: string): Promise<ResolvedToken> {
  const record = await loadValidToken(rawToken);
  const org = record.matchedOrganization;
  const eligibleSchools =
    org.organizationType === "DISTRICT" ? org.schools.filter((s) => s.status === "ACTIVE") : [];
  // Rostered students aren't asked for a campus: the roster already says it,
  // and completeSchoolVerification uses the roster's answer.
  const roster = await lookupRosterEntry(record.requestedEmail);
  const rostered = roster?.entry.organizationId === org.id;

  return {
    tokenId: record.id,
    studentId: record.studentId,
    organization: {
      id: org.id,
      officialName: org.officialName,
      organizationType: org.organizationType,
    },
    requiresSchoolSelection: !rostered && org.organizationType === "DISTRICT" && eligibleSchools.length > 1,
    schools: eligibleSchools.map((s) => ({ id: s.id, officialName: s.officialName })),
  };
}

/** PRD-002 §11.1 system actions, plus PRD-003 §16's district-transition rule. */
export async function completeSchoolVerification(
  rawToken: string,
  currentStudentId: string,
  selectedSchoolId?: string,
): Promise<void> {
  const record = await loadValidToken(rawToken);

  if (record.studentId !== currentStudentId) {
    throw new SchoolVerificationError(
      "WRONG_ACCOUNT",
      "This verification link was created for a different PrepHub account.",
    );
  }

  const [existingMembership, student] = await Promise.all([
    prisma.studentMembership.findUnique({ where: { studentId: currentStudentId } }),
    prisma.user.findUniqueOrThrow({ where: { id: currentStudentId } }),
  ]);
  if (student.role !== "STUDENT") {
    throw new SchoolVerificationError(
      "NOT_A_STUDENT",
      "School access connects to a student account. Staff accounts already have everything they need.",
    );
  }
  if (existingMembership) {
    throw new SchoolVerificationError(
      "ALREADY_HAS_MEMBERSHIP",
      "This account already has school-provided access connected.",
    );
  }

  const org = record.matchedOrganization;
  if (org.status !== "ACTIVE") {
    throw new SchoolVerificationError(
      "PARTNERSHIP_INACTIVE",
      "PrepHub access is no longer available through this school or district.",
    );
  }
  await requireOnRosterIfRosterOnly(org, record.requestedEmail);

  // A roster entry names the student's campus, so a district that rostered
  // this address has already answered the question a multi-campus district
  // would otherwise ask.
  const roster = await lookupRosterEntry(record.requestedEmail);
  const rosterEntry = roster?.entry.organizationId === org.id ? roster.entry : null;

  let schoolId: string;
  if (rosterEntry) {
    schoolId = rosterEntry.schoolId;
  } else if (org.organizationType === "SCHOOL") {
    schoolId = org.id;
  } else {
    const eligibleSchools = org.schools.filter((s) => s.status === "ACTIVE");
    if (eligibleSchools.length === 1) {
      schoolId = eligibleSchools[0].id;
    } else if (eligibleSchools.length === 0) {
      throw new SchoolVerificationError(
        "PARTNERSHIP_INACTIVE",
        "This district doesn't have any active schools configured yet.",
      );
    } else {
      const match = eligibleSchools.find((s) => s.id === selectedSchoolId);
      if (!match) {
        throw new SchoolVerificationError(
          "NEEDS_SCHOOL_SELECTION",
          "Select your school to finish verification.",
        );
      }
      schoolId = match.id;
    }
  }

  const grade = student.grade ?? gradeFromGraduationYear(rosterEntry?.graduationYear ?? null) ?? 9;
  const expectedGraduationYear = rosterEntry?.graduationYear ?? computeExpectedGraduationYear(grade);

  await prisma.$transaction([
    prisma.schoolVerificationToken.update({
      where: { id: record.id },
      data: { completedAt: new Date() },
    }),
    prisma.studentMembership.create({
      data: {
        studentId: currentStudentId,
        organizationId: org.id,
        schoolId,
        verifiedSchoolEmail: record.requestedEmail,
        currentGrade: grade,
        expectedGraduationYear,
        activationMethod: "SCHOOL_EMAIL_VERIFICATION",
      },
    }),
  ]);

  // PRD-003 §16: an existing paid subscription isn't cancelled outright — it's
  // scheduled not to renew, so access continues uninterrupted through the
  // current billing period. Runs after the transaction (calls Stripe over the
  // network; best-effort — see scheduleSubscriptionNonRenewal) so the student's
  // district access isn't blocked by a transient Stripe API failure.
  await scheduleSubscriptionNonRenewal(currentStudentId);
}
