import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";
import { sendEmail } from "@/lib/email";
import { CURRENT_PRIVACY_VERSION, CURRENT_TOS_VERSION } from "@/lib/legal";
import { AuthError } from "@/lib/auth/errors";
import type { SignUpInput } from "@/lib/validation/auth";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** PRD-001: email/password signup. Google-account matching happens separately
 *  in the Auth.js signIn flow (allowDangerousEmailAccountLinking), not here. */
export async function createAccount(input: SignUpInput) {
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
    text: `Click the link below to reset your password. This link expires in 1 hour and can only be used once.\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
  });
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { token: hashToken(token) },
  });

  if (!record || record.usedAt) {
    throw new AuthError("INVALID_TOKEN", "This reset link is invalid or has already been used.");
  }
  if (record.expiresAt < new Date()) {
    throw new AuthError("TOKEN_EXPIRED", "This reset link has expired.");
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        // Invalidate every outstanding session — a password reset is a strong
        // signal the previous session(s) may not be trusted.
        tokenVersion: { increment: 1 },
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);
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
export async function deleteAccount(userId: string, password: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) {
    throw new AuthError("INVALID_CREDENTIALS", "Account not found.");
  }

  // Accounts created via Google-only have no password to reauthenticate with.
  // TODO: before launch, add an OAuth re-auth challenge for that path instead
  // of skipping reauthentication entirely.
  if (user.passwordHash) {
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw new AuthError("INVALID_CREDENTIALS", "Incorrect password.");
    }
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        email: `deleted-${userId}@deleted.prephub.invalid`,
        firstName: "Deleted User",
        passwordHash: null,
        image: null,
        tokenVersion: { increment: 1 },
      },
    }),
    prisma.account.deleteMany({ where: { userId } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
}
