import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { scheduleSubscriptionNonRenewal } from "@/lib/billing";
import { invalidateAccessContext } from "@/lib/entitlements";
import { logEvent } from "@/lib/logger";
import { ensureDistrictMembership, findDistrictMatch, type DistrictMatch, type EnrollmentOutcome } from "./enrollment";

/**
 * Confirming a password account's own email, so its district access can
 * switch on (2026-10-24).
 *
 * Google sign-in arrives with `emailVerified` already set, which is what lets
 * a district Google Workspace account enroll with no extra step. A password
 * signup has only *typed* its address, and enrolling on that would let anyone
 * claim a district seat by typing `someone@district.org`. So a password
 * account whose email a district recognises is sent one link to that
 * address; confirming it sets `emailVerified` and runs the same enrollment a
 * Google sign-in gets. Nothing else in the account changes.
 *
 * **Confirming takes a button press, not a page view.** School mail systems
 * (Microsoft Defender's Safe Links, Google's scanners) open every link in an
 * incoming message to check it. If opening the page were enough, a scanner
 * would confirm an address on behalf of whoever typed it into a signup form —
 * which is exactly the impersonation this step exists to stop. Scanners fetch
 * pages; they don't submit forms.
 */

/** Long enough for a student who checks their school inbox once a week. */
export const EMAIL_VERIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function siteUrl(): string {
  return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}

/** The one name a student will recognise in a message about their match. */
function matchName(match: DistrictMatch): string | null {
  if (match.kind === "MATCH") return match.schoolName;
  if (match.kind === "NEEDS_CAMPUS") return match.organizationName;
  return null;
}

export type SendVerificationResult = "SENT" | "ALREADY_VERIFIED" | "NOT_ELIGIBLE" | "FAILED";

/**
 * Emails a confirmation link to the account's own address — only when a
 * district would actually act on it, so an ordinary signup never gets an
 * email asking it to confirm something that unlocks nothing.
 */
export async function sendDistrictVerificationEmail(userId: string): Promise<SendVerificationResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true, firstName: true, role: true, deletedAt: true },
  });
  if (!user || user.role !== "STUDENT" || user.deletedAt) return "NOT_ELIGIBLE";
  if (user.emailVerified) return "ALREADY_VERIFIED";

  const match = await findDistrictMatch(user.email);
  const name = matchName(match);
  if (!name) return "NOT_ELIGIBLE";

  const rawToken = randomBytes(32).toString("hex");
  await prisma.emailVerificationToken.create({
    data: {
      userId,
      email: user.email.toLowerCase(),
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
    },
  });

  const result = await sendEmail({
    to: user.email,
    subject: `${name} covers your PrepHub Premium — confirm your email`,
    text: `Hi ${user.firstName},

${name} provides PrepHub Premium to its students, free. Confirm this is your school email and it switches on:

${siteUrl()}/verify-email/${rawToken}

The link works once and lasts a week. If you didn't sign up for PrepHub, ignore this — nothing happens unless the button on that page is pressed.

— Prithvi, PrepHub`,
  });
  return result.ok ? "SENT" : "FAILED";
}

export type VerificationInspection =
  | { state: "INVALID" }
  | { state: "EXPIRED"; userId: string; email: string }
  | { state: "USED"; userId: string; email: string }
  | { state: "READY"; userId: string; email: string; firstName: string; match: DistrictMatch };

/**
 * Read-only: what the confirmation page should show. Never consumes the
 * token — see the note at the top about mail scanners.
 */
export async function inspectEmailVerification(rawToken: string): Promise<VerificationInspection> {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: { select: { id: true, email: true, firstName: true, deletedAt: true } } },
  });
  // A link for an address the account no longer has proves nothing about it.
  if (!record || record.user.deletedAt || record.user.email.toLowerCase() !== record.email) {
    return { state: "INVALID" };
  }
  if (record.usedAt) return { state: "USED", userId: record.userId, email: record.email };
  if (record.expiresAt <= new Date()) return { state: "EXPIRED", userId: record.userId, email: record.email };
  return {
    state: "READY",
    userId: record.userId,
    email: record.email,
    firstName: record.user.firstName,
    match: await findDistrictMatch(record.email),
  };
}

export type ConfirmVerificationResult =
  | { ok: false; reason: "INVALID" | "EXPIRED" }
  | { ok: true; userId: string; email: string; outcome: EnrollmentOutcome };

/**
 * Consumes the link, marks the address verified, and runs district
 * enrollment. Idempotent: a second press (a double click, a retried request,
 * the same link opened on another device) finds the token used and simply
 * reports where enrollment stands now.
 *
 * `schoolId` is the campus a student picked on the confirmation page, for a
 * multi-campus district that can't be told apart by domain.
 */
export async function confirmEmailVerification(
  rawToken: string,
  options: { schoolId?: string } = {},
): Promise<ConfirmVerificationResult> {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: { select: { id: true, email: true, deletedAt: true } } },
  });
  if (!record || record.user.deletedAt || record.user.email.toLowerCase() !== record.email) {
    return { ok: false, reason: "INVALID" };
  }

  if (!record.usedAt) {
    if (record.expiresAt <= new Date()) return { ok: false, reason: "EXPIRED" };
    const now = new Date();
    await prisma.$transaction([
      // Guarded on usedAt so two simultaneous presses can't both "consume" it;
      // the loser just finds the user already verified below, which is fine.
      prisma.emailVerificationToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: now } }),
      prisma.user.updateMany({ where: { id: record.userId, emailVerified: null }, data: { emailVerified: now } }),
    ]);
  }

  const outcome = await ensureDistrictMembership(record.userId, options);
  if (outcome === "CREATED") {
    invalidateAccessContext(record.userId);
    // PRD-003 §16, as for any student whose school starts covering them: a
    // subscription they bought while waiting is set not to renew rather than
    // cancelled, so they keep what they paid for and are never charged again.
    try {
      await scheduleSubscriptionNonRenewal(record.userId);
    } catch (err) {
      logEvent("SCHOOL_VERIFICATION_FAILURE", "Could not schedule non-renewal after district enrollment", {
        accountId: record.userId,
        reason: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  return { ok: true, userId: record.userId, email: record.email, outcome };
}

/**
 * Sends a fresh link to whoever an expired link belonged to, so a student who
 * opens a week-old email isn't sent off to log in just to ask for another.
 * Only the account the link was for can receive it: the new link goes to the
 * same address, never one supplied by the visitor.
 */
export async function resendFromExpiredLink(rawToken: string): Promise<SendVerificationResult> {
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: { userId: true },
  });
  if (!record) return "NOT_ELIGIBLE";
  return sendDistrictVerificationEmail(record.userId);
}
