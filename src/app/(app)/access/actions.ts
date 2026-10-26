"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { searchOrganizations, type DirectoryResult } from "@/lib/organizations";
import { requestSchoolVerification, completeSchoolVerification } from "@/lib/school-verification";
import { SchoolVerificationError } from "@/lib/school-verification/errors";
import { schoolEmailSchema, schoolSelectionSchema } from "@/lib/validation/school-verification";
import { checkRateLimitEnforced, RATE_LIMITS } from "@/lib/rate-limit";
import { logRateLimitExceeded, logSchoolVerificationFailure } from "@/lib/logger";
import { ensureDistrictMembership } from "@/lib/district/enrollment";
import { sendDistrictVerificationEmail } from "@/lib/district/email-verification";
import type { ResendState } from "@/components/district-bar";

export type ActionState = { error?: string; success?: boolean };

export async function searchOrganizationsAction(query: string): Promise<DirectoryResult[]> {
  return searchOrganizations(query);
}

export async function requestSchoolVerificationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user.id) redirect("/login");

  const parsed = schoolEmailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // GER §3: this action is already authenticated, so it's rate-limited by
  // internal account id rather than IP/email — GER §5 prefers internal
  // account ids over emails in general logs/keys where one is available.
  const rateLimit = await checkRateLimitEnforced(
    `school-verification:${session.user.id}`,
    RATE_LIMITS.SCHOOL_EMAIL_VERIFICATION_REQUEST,
  );
  if (!rateLimit.allowed) {
    logRateLimitExceeded("School-email verification request rate limit exceeded", {
      accountId: session.user.id,
    });
    return { error: "Too many attempts. Please wait a few minutes and try again." };
  }

  try {
    await requestSchoolVerification(session.user.id, parsed.data.email);
  } catch (err) {
    if (err instanceof SchoolVerificationError) {
      logSchoolVerificationFailure(err.message, { accountId: session.user.id, errorType: err.code });
      return { error: err.message };
    }
    throw err;
  }

  return { success: true };
}

export async function completeSchoolVerificationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user.id) redirect("/login");

  const parsed = schoolSelectionSchema.safeParse({
    token: formData.get("token"),
    schoolId: formData.get("schoolId"),
  });

  // schoolId is optional for single-school orgs — only validate token presence there.
  const token = formData.get("token");
  if (typeof token !== "string" || !token) {
    return { error: "Invalid verification link." };
  }
  const schoolId = parsed.success ? parsed.data.schoolId : undefined;

  try {
    await completeSchoolVerification(token, session.user.id, schoolId);
  } catch (err) {
    if (err instanceof SchoolVerificationError) {
      logSchoolVerificationFailure(err.message, { accountId: session.user.id, errorType: err.code });
      return { error: err.message };
    }
    throw err;
  }

  redirect("/access/success");
}

/**
 * "Resend the link" in the district bar: a fresh confirmation email to the
 * account's own address. Keyed per account, like the school-email request
 * above, so a campus never shares a bucket.
 */
export async function resendDistrictVerificationAction(): Promise<ResendState> {
  const session = await auth();
  if (!session?.user.id) redirect("/login");

  const rateLimit = await checkRateLimitEnforced(
    `account-email-verification:${session.user.id}`,
    RATE_LIMITS.SCHOOL_EMAIL_VERIFICATION_REQUEST,
  );
  if (!rateLimit.allowed) {
    logRateLimitExceeded("Account email verification resend rate limit exceeded", { accountId: session.user.id });
    return { error: "That's a lot of emails in a row — give it a few minutes, then check your spam folder too." };
  }

  const result = await sendDistrictVerificationEmail(session.user.id);
  switch (result) {
    case "SENT":
      return { message: "Sent. It can take a minute — check spam if it isn't there." };
    case "ALREADY_VERIFIED":
      return { message: "You're already confirmed. Refresh the page." };
    case "FAILED":
      return { error: "We couldn't send it just now. Try again in a minute." };
    case "NOT_ELIGIBLE":
      return { error: "Your school's PrepHub access isn't available for this email right now." };
  }
}

export type CampusState = { error?: string };

/**
 * A verified student in a multi-campus district says which school they go
 * to. `ensureDistrictMembership` accepts the choice only if it is one of that
 * district's own campuses, so a hand-edited form can't move anyone anywhere.
 */
export async function chooseCampusAction(_prev: CampusState, formData: FormData): Promise<CampusState> {
  const session = await auth();
  if (!session?.user.id) redirect("/login");

  const schoolId = formData.get("schoolId");
  if (typeof schoolId !== "string" || !schoolId) return { error: "Choose your school to continue." };

  const outcome = await ensureDistrictMembership(session.user.id, { schoolId });
  if (outcome === "CREATED" || outcome === "ALREADY_MEMBER") redirect("/home");
  if (outcome === "NEEDS_CAMPUS") return { error: "Choose one of the schools listed." };
  if (outcome === "NEEDS_EMAIL_VERIFICATION") return { error: "Confirm your email first — the link is in your inbox." };
  return { error: "Your school's PrepHub access isn't available for this account right now." };
}
