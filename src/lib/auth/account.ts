import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { FUNNEL_EVENTS, track } from "@/lib/analytics/track";
import { hashPassword, verifyPassword } from "@/lib/password";
import { sendEmail } from "@/lib/email";
import { CURRENT_PRIVACY_VERSION, CURRENT_TOS_VERSION } from "@/lib/legal";
import { AuthError } from "@/lib/auth/errors";
import { cancelSubscriptionForDeletedAccount } from "@/lib/billing";
import { DELETE_CONFIRMATION_WORD } from "@/lib/auth/delete-confirmation";
import type { SignUpInput } from "@/lib/validation/auth";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** PRD-001: email/password signup. Google-account matching happens separately
 *  in the Auth.js signIn flow (allowDangerousEmailAccountLinking), not here. */
export async function createAccount(input: SignUpInput) {
  const created = await createAccountRow(input);
  void track(FUNNEL_EVENTS.SIGNED_UP, { userId: created.id, path: "/signup" });
  return created;
}

async function createAccountRow(input: SignUpInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AuthError("EMAIL_TAKEN", "An account with this email already exists.");
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      firstName: input.firstName,
      email: input.email,
      passwordHash,
      ageConfirmed: input.ageConfirmed,
      legalAcceptances: {
        create: [
          { tosVersion: CURRENT_TOS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION },
        ],
      },
    },
  });

  // Best-effort — a failed welcome email must never fail signup itself
  // (sendEmail already never throws; see its own internals).
  await sendWelcomeEmail(user);

  return user;
}

// Every new student account gets this exactly once — called from both signup
// paths that can create a brand-new User row (credentials, here, and the
// Google OAuth adapter's createUser in src/auth.ts). A Google sign-in that
// links to an *existing* account (allowDangerousEmailAccountLinking) never
// calls createUser, so this can't double-send for that case.
export async function sendWelcomeEmail(user: { email: string; firstName: string }): Promise<void> {
  await sendEmail({
    to: user.email,
    subject: "Welcome to PrepHub",
    text: `Hi ${user.firstName},

I’m Prithvi, the founder of PrepHub. Thank you for joining our platform; it means a lot to have you here.

PrepHub is built around a proven framework designed to help students improve their SAT scores as efficiently as possible through personalized, consistent practice.

Your first step is to complete the diagnostic assessment. Once you finish, you’ll receive an initial predicted SAT score range based on your performance. From there, PrepHub will create personalized practice sets based on your strengths and weaknesses. Your predicted score will update after every completed practice set, allowing you to track your progress over time.

Every question also includes an in-depth explanation, so you can understand why an answer is correct and learn from any mistakes you make.

For the best results, focus on consistency rather than trying to complete a large number of questions at once. Complete a practice set, carefully review the explanations, and return regularly. You’ll also build a daily study streak as you practice, helping you stay accountable and turn SAT preparation into a habit.

To help you stay consistent, we’ll send you an email reminder if your streak ends so you can get back on track and continue making progress.

We’re excited to be part of your SAT journey. Thank you again for choosing PrepHub.

Best,
Prithvi
Founder of PrepHub`,
  });
}

/** PRD-001: always responds the same way whether or not the email exists, to
 *  avoid leaking which emails have accounts. */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.deletedAt) return;

  const token = randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      token: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  const resetUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/reset-password/${token}`;
  await sendEmail({
    to: user.email,
    subject: "Reset your PrepHub password",
    text: `Hi ${user.firstName},

Here's the link to reset your PrepHub password. It expires in an hour and works once:

${resetUrl}

If you didn't ask for this you can ignore this email and nothing changes. If you're stuck getting back in, just reply to this and I'll sort it out.

— Prithvi, PrepHub`,
  });
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { token: hashToken(token) },
  });

  if (!record || record.usedAt) {
    throw new AuthError(
      "INVALID_TOKEN",
      "This link has already been used or isn't valid.",
    );
  }
  if (record.expiresAt < new Date()) {
    throw new AuthError(
      "TOKEN_EXPIRED",
      "This link has expired. If you were invited as a teacher, your administrator can also send the invitation again.",
    );
  }

  const passwordHash = await hashPassword(newPassword);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Claimed first and conditionally, so two submits of the same link can't
    // both set a password: the loser finds the token already used.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count === 0) {
      throw new AuthError("INVALID_TOKEN", "This link has already been used. Sign in with your new password.");
    }
    await tx.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        // Invalidate every outstanding session — a password reset is a strong
        // signal the previous session(s) may not be trusted.
        tokenVersion: { increment: 1 },
      },
    });
    // The link arrived at this account's address, so using it proves the
    // address is theirs — which is what district enrollment waits for on a
    // password account (src/lib/district/enrollment.ts).
    await tx.user.updateMany({ where: { id: record.userId, emailVerified: null }, data: { emailVerified: now } });
    // Any other link still sitting in the inbox (an earlier reset, a teacher
    // invitation) stops working once a password has been chosen.
    await tx.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: now },
    });
  });
}

export async function logOutAllDevices(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
}

/** PRD-001: self-service, reauthenticated, atomic, and anonymizing rather than
 *  a hard delete — history is retained for legal/fraud/tax reasons but PII is
 *  scrubbed and the account can no longer be used or discovered by email. */
export async function deleteAccount(
  userId: string,
  confirm: { password?: string; confirmation?: string },
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) {
    throw new AuthError("INVALID_CREDENTIALS", "Account not found.");
  }

  if (user.passwordHash) {
    const valid = !!confirm.password && (await verifyPassword(confirm.password, user.passwordHash));
    if (!valid) {
      throw new AuthError("INVALID_CREDENTIALS", "Incorrect password.");
    }
  } else if (confirm.confirmation?.trim().toUpperCase() !== DELETE_CONFIRMATION_WORD) {
    // A Google-only account has no password to re-enter, which used to mean a
    // single click deleted it. Typing the word is the deliberate second step.
    throw new AuthError("INVALID_CREDENTIALS", `Type ${DELETE_CONFIRMATION_WORD} to confirm.`);
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        deletedAt: now,
        email: `deleted-${userId}@deleted.prephub.invalid`,
        firstName: "Deleted User",
        passwordHash: null,
        image: null,
        tokenVersion: { increment: 1 },
      },
    });
    await tx.account.deleteMany({ where: { userId } });
    await tx.session.deleteMany({ where: { userId } });

    // School access ends with the account, the way an Owner's removal does
    // (PRD-017 §14), with the same audit record. The school address is
    // personal data and also unique: left in place, it kept "Deleted User" in
    // the school's figures and leaderboard, and made the student's own
    // re-registration with that address fail to enroll.
    const membership = await tx.studentMembership.findUnique({ where: { studentId: userId } });
    if (membership) {
      await tx.studentMembership.update({
        where: { id: membership.id },
        data: {
          verifiedSchoolEmail: `deleted-${membership.id}@deleted.prephub.invalid`,
          ...(membership.status === "ACTIVE" ? { status: "REMOVED" as const, removedAt: now } : {}),
        },
      });
      if (membership.status === "ACTIVE") {
        await tx.membershipHistoryEvent.create({
          data: {
            membershipId: membership.id,
            eventType: "REMOVAL",
            performedByAccountId: userId,
            optionalReason: "Account deleted by the student",
          },
        });
      }
    }
    await tx.classroomEnrollment.updateMany({ where: { studentId: userId, removedAt: null }, data: { removedAt: now } });

    // A teacher's classes would otherwise live on without anyone able to see
    // or close them: join codes still working, homework still arriving from
    // "Deleted User". Archived exactly as an administrator's removal does.
    await tx.classroom.updateMany({ where: { teacherId: userId, archivedAt: null }, data: { archivedAt: now } });
    await tx.teacherAssignment.updateMany({ where: { userId, removedAt: null }, data: { removedAt: now } });
    await tx.administratorAssignment.updateMany({ where: { userId, removedAt: null }, data: { removedAt: now } });
  });

  // After the transaction: the deletion stands even if Stripe is unreachable.
  await cancelSubscriptionForDeletedAccount(userId);
}
