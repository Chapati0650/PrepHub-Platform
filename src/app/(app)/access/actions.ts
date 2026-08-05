"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { searchOrganizations, type DirectoryResult } from "@/lib/organizations";
import { requestSchoolVerification, completeSchoolVerification } from "@/lib/school-verification";
import { SchoolVerificationError } from "@/lib/school-verification/errors";
import { schoolEmailSchema, schoolSelectionSchema } from "@/lib/validation/school-verification";
import { checkRateLimitEnforced, RATE_LIMITS } from "@/lib/rate-limit";
import { logRateLimitExceeded, logSchoolVerificationFailure } from "@/lib/logger";

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
  const rateLimit = checkRateLimitEnforced(
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
