"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { RUSH_JOIN_COOKIE } from "@/lib/rush/join-cookie";
import { readPendingRushCode } from "@/lib/rush/pending-join";
import { AuthError as NextAuthError } from "next-auth";
import { signIn } from "@/auth";
import {
  signUpSchema,
  loginSchema,
  requestPasswordResetSchema,
  confirmPasswordResetSchema,
} from "@/lib/validation/auth";
import { createAccount, requestPasswordReset, confirmPasswordReset } from "@/lib/auth/account";
import { ensureDistrictMembership, isDistrictCandidateEmail } from "@/lib/district/enrollment";
import { sendDistrictVerificationEmail } from "@/lib/district/email-verification";
import { AuthError } from "@/lib/auth/errors";
import { checkRateLimitEnforced, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { logAuthFailure, logEvent, logRateLimitExceeded } from "@/lib/logger";

const TOO_MANY_REQUESTS_MESSAGE = "Too many attempts. Please wait a few minutes and try again.";

export type ActionState = { error?: string; success?: boolean };

export async function signUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse({
    firstName: formData.get("firstName"),
    email: formData.get("email"),
    password: formData.get("password"),
    ageConfirmed: formData.get("ageConfirmed") === "on",
    tosAccepted: formData.get("tosAccepted") === "on",
    privacyAccepted: formData.get("privacyAccepted") === "on",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // GER §3: account creation is rate-limited by client IP — the target of
  // abuse here is volumetric fake-account creation, not one specific email,
  // so unlike login/password-reset there's no per-account key to add.
  const ip = await getClientIp();
  const rateLimit = checkRateLimitEnforced(`signup:${ip}`, RATE_LIMITS.ACCOUNT_CREATION_PER_IP);
  if (!rateLimit.allowed) {
    logRateLimitExceeded("Account creation rate limit exceeded", { ip });
    return { error: TOO_MANY_REQUESTS_MESSAGE };
  }

  let created: Awaited<ReturnType<typeof createAccount>>;
  try {
    created = await createAccount(parsed.data);
  } catch (err) {
    if (err instanceof AuthError) return { error: err.message };
    throw err;
  }

  // Signing up with an address a district recognises — on its domain or on
  // its roster: send the confirmation link straight away, so it is already
  // waiting by the time the three onboarding questions are done.
  //
  // Credentials signup verifies no email at all — anyone could type an
  // address at a partner domain — so this path cannot auto-enroll the way a
  // Google Workspace sign-in does. One click in their inbox is the smallest
  // honest version of it. `ensureDistrictMembership` is what decides: it
  // answers NEEDS_EMAIL_VERIFICATION only for a live match, so an ordinary
  // signup is never sent an email asking it to confirm something that
  // unlocks nothing. The candidate check in front of it is in-memory, so the
  // common signup pays no query. Best-effort: a student who never clicks
  // still has a working account, and the app shell shows them the prompt.
  try {
    if (
      (await isDistrictCandidateEmail(created.email)) &&
      (await ensureDistrictMembership(created.id)) === "NEEDS_EMAIL_VERIFICATION"
    ) {
      await sendDistrictVerificationEmail(created.id);
    }
  } catch (err) {
    logEvent("SCHOOL_VERIFICATION_FAILURE", "Could not send the district confirmation email at signup", {
      accountId: created.id,
      reason: err instanceof Error ? err.message : "unknown",
    });
  }

  // Immediately sign in the newly-created account rather than making the
  // student log in a second time right after signing up.
  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch {
    // Account was created successfully even if auto-login fails for some reason;
    // send them to log in manually instead of losing the signup.
    redirect("/login");
  }

  // A friend's 1v1 Rush link opened while signed out (see middleware.ts):
  // the challenge is the reason this account exists, so it comes first.
  // Cleared here — a Server Action may write cookies — so nothing redirects
  // to it twice.
  const pendingRushCode = await readPendingRushCode();
  if (pendingRushCode) {
    (await cookies()).delete(RUSH_JOIN_COOKIE);
    redirect(`/rush/join/${pendingRushCode}`);
  }

  // Straight to /onboarding — grade, target score and study commitment,
  // three screens, no welcome step (Owner, 2026-09-21: a new account must
  // be asked these before the Diagnostic, not after). Not /home: /home
  // would only redirect here, and every extra hop through a Server Action
  // redirect has been a real failure source on this host.
  redirect("/onboarding");
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // GER §3: keyed by both IP and the targeted email so a single attacker
  // hammering one account and an attacker spraying many accounts from one
  // IP are both slowed down, without either check alone blocking a student
  // who's simply retyping their own password a few times. The two limits are
  // deliberately very different sizes — see RATE_LIMITS: a whole campus shares
  // one public IP, so the IP bucket has to fit a computer lab, while the email
  // bucket is the one doing the security work.
  const ip = await getClientIp();
  const ipLimit = checkRateLimitEnforced(`login:ip:${ip}`, RATE_LIMITS.LOGIN_PER_IP);
  const emailLimit = checkRateLimitEnforced(`login:email:${parsed.data.email}`, RATE_LIMITS.LOGIN_PER_EMAIL);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    logRateLimitExceeded("Login rate limit exceeded", { ip, email: parsed.data.email });
    return { error: TOO_MANY_REQUESTS_MESSAGE };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
  } catch (err) {
    if (err instanceof NextAuthError) {
      logAuthFailure("Login failed: incorrect credentials", { email: parsed.data.email, ip });
      return { error: "Incorrect email or password." };
    }
    throw err;
  }

  redirect("/home");
}

export async function requestPasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = requestPasswordResetSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // GER §3: checked before touching the database, so the rate-limited
  // response fires identically whether or not `email` belongs to a real
  // account — it can't be used to distinguish registered from unregistered
  // addresses, preserving PRD-001's "identical response either way" rule.
  const ip = await getClientIp();
  const ipLimit = checkRateLimitEnforced(`password-reset:ip:${ip}`, RATE_LIMITS.PASSWORD_RESET_PER_IP);
  const emailLimit = checkRateLimitEnforced(
    `password-reset:email:${parsed.data.email}`,
    RATE_LIMITS.PASSWORD_RESET_PER_EMAIL,
  );
  if (!ipLimit.allowed || !emailLimit.allowed) {
    logRateLimitExceeded("Password reset request rate limit exceeded", { ip, email: parsed.data.email });
    return { error: TOO_MANY_REQUESTS_MESSAGE };
  }

  await requestPasswordReset(parsed.data.email);

  // PRD-001: identical response whether or not the email is registered.
  return { success: true };
}

export async function confirmPasswordResetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = confirmPasswordResetSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    await confirmPasswordReset(parsed.data.token, parsed.data.password);
  } catch (err) {
    if (err instanceof AuthError) return { error: err.message };
    throw err;
  }

  redirect("/login");
}
