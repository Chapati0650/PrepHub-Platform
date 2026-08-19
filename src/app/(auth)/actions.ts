"use server";

import { redirect } from "next/navigation";
import { AuthError as NextAuthError } from "next-auth";
import { signIn } from "@/auth";
import {
  signUpSchema,
  loginSchema,
  requestPasswordResetSchema,
  confirmPasswordResetSchema,
} from "@/lib/validation/auth";
import { createAccount, requestPasswordReset, confirmPasswordReset } from "@/lib/auth/account";
import { AuthError } from "@/lib/auth/errors";
import { checkRateLimitEnforced, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { logAuthFailure, logRateLimitExceeded } from "@/lib/logger";

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
  const rateLimit = checkRateLimitEnforced(`signup:${ip}`, RATE_LIMITS.ACCOUNT_CREATION);
  if (!rateLimit.allowed) {
    logRateLimitExceeded("Account creation rate limit exceeded", { ip });
    return { error: TOO_MANY_REQUESTS_MESSAGE };
  }

  try {
    await createAccount(parsed.data);
  } catch (err) {
    if (err instanceof AuthError) return { error: err.message };
    throw err;
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

  redirect("/home");
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
  // who's simply retyping their own password a few times.
  const ip = await getClientIp();
  const ipLimit = checkRateLimitEnforced(`login:ip:${ip}`, RATE_LIMITS.LOGIN);
  const emailLimit = checkRateLimitEnforced(`login:email:${parsed.data.email}`, RATE_LIMITS.LOGIN);
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
  const ipLimit = checkRateLimitEnforced(`password-reset:ip:${ip}`, RATE_LIMITS.PASSWORD_RESET_REQUEST);
  const emailLimit = checkRateLimitEnforced(`password-reset:email:${parsed.data.email}`, RATE_LIMITS.PASSWORD_RESET_REQUEST);
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
