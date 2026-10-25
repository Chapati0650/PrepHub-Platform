"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { confirmEmailVerification, resendFromExpiredLink } from "@/lib/district/email-verification";
import type { EnrollmentOutcome } from "@/lib/district/enrollment";
import { checkRateLimitEnforced, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { logRateLimitExceeded } from "@/lib/logger";

export type ConfirmState = {
  error?: string;
  /** Confirmed, but the visitor isn't signed in as this account here. */
  done?: { outcome: EnrollmentOutcome; email: string; signedInElsewhere: boolean };
};

/**
 * The button on the confirmation page. Deliberately not authenticated: the
 * link is opened wherever the student reads their school email, which is
 * often a phone that has never signed in to PrepHub. The token is the proof.
 */
export async function confirmEmailVerificationAction(_prev: ConfirmState, formData: FormData): Promise<ConfirmState> {
  const token = formData.get("token");
  if (typeof token !== "string" || !token) return { error: "This link doesn't work." };
  const rawSchool = formData.get("schoolId");
  const schoolId = typeof rawSchool === "string" && rawSchool ? rawSchool : undefined;

  const result = await confirmEmailVerification(token, { schoolId });
  if (!result.ok) {
    return {
      error:
        result.reason === "EXPIRED"
          ? "This link has expired. Reload the page and we'll send you a fresh one."
          : "This link doesn't work. Log in to PrepHub and use “Resend the link” at the top of the page.",
    };
  }

  const session = await auth();
  const signedInHere = session?.user?.id === result.userId;
  // Signed in on this device as this student: straight to /home, where the
  // celebration plays (or onboarding, if they haven't answered its three
  // questions yet — finishing it is what enrolls them then).
  if (signedInHere && result.outcome !== "NEEDS_CAMPUS") redirect("/home");
  if (signedInHere) redirect("/access/campus");

  return {
    done: {
      outcome: result.outcome,
      email: result.email,
      signedInElsewhere: Boolean(session?.user?.id),
    },
  };
}

export type ResendExpiredState = { message?: string; error?: string };

/**
 * "Send a new link" on an expired one. The new link goes to the address the
 * old one was for — never to anything the visitor types — so this can't be
 * used to point a confirmation at someone else's inbox.
 */
export async function resendExpiredVerificationAction(
  _prev: ResendExpiredState,
  formData: FormData,
): Promise<ResendExpiredState> {
  const token = formData.get("token");
  if (typeof token !== "string" || !token) return { error: "This link doesn't work." };

  const ip = await getClientIp();
  const ipLimit = checkRateLimitEnforced(`email-verify-resend:ip:${ip}`, RATE_LIMITS.PASSWORD_RESET_PER_IP);
  const linkLimit = checkRateLimitEnforced(
    `email-verify-resend:link:${token.slice(0, 24)}`,
    RATE_LIMITS.SCHOOL_EMAIL_VERIFICATION_REQUEST,
  );
  if (!ipLimit.allowed || !linkLimit.allowed) {
    logRateLimitExceeded("Expired verification link resend rate limit exceeded", { ip });
    return { error: "That's a lot of emails in a row — give it a few minutes." };
  }

  const result = await resendFromExpiredLink(token);
  if (result === "SENT") return { message: "Sent. Check your school inbox — and spam, just in case." };
  if (result === "ALREADY_VERIFIED") return { message: "You're already confirmed. Log in to PrepHub to start." };
  if (result === "FAILED") return { error: "We couldn't send it just now. Try again in a minute." };
  return { error: "Your school's PrepHub access isn't available for this email right now." };
}
