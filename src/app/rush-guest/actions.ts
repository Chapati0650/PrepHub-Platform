"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { createAccount } from "@/lib/auth/account";
import { logEvent, logRateLimitExceeded } from "@/lib/logger";
import { checkRateLimitEnforced, getClientIp, RATE_LIMITS } from "@/lib/rate-limit";
import { normalizeRushCode } from "@/lib/rush/codes";
import { RushError } from "@/lib/rush/errors";
import { guestRoomProblem } from "@/lib/rush/guest-join";
import { isGuestRoomCode } from "@/lib/rush/guest-rooms";
import { joinChallenge } from "@/lib/rush/runs";

export type GuestJoinState = { error?: string; firstName?: string };

// Joining a guest room (src/lib/rush/guest-rooms.ts) without an account: a
// throwaway student account is made with the first name typed, signed in,
// and put in the room. Same per-IP limit as signing up.
export async function joinRushAsGuestAction(_prev: GuestJoinState, formData: FormData): Promise<GuestJoinState> {
  const code = normalizeRushCode(String(formData.get("code") ?? ""));
  if (!code || !isGuestRoomCode(code)) return { error: "That link doesn't match a live room." };
  const firstName = String(formData.get("firstName") ?? "").trim().replace(/\s+/g, " ").slice(0, 40);

  // Already signed in with an account that can play (another tab, or the
  // back button): the ordinary join. One that can't (Owner, teacher) carries
  // on as a guest; signing the guest in replaces that session.
  const session = await auth();
  if (session?.user?.id && canUseStudentExperience(session.user.role)) redirect(`/rush/join/${code}`);

  if (!firstName) return { error: "Type your first name. It's what your opponent sees.", firstName };
  if (formData.get("ageConfirmed") !== "on") return { error: "Confirm you're 13 or older to play.", firstName };

  const ip = await getClientIp();
  const limit = await checkRateLimitEnforced(`signup:${ip}`, RATE_LIMITS.ACCOUNT_CREATION_PER_IP);
  if (!limit.allowed) {
    logRateLimitExceeded("Guest Rush join rate limit exceeded", { ip });
    return { error: "Too many attempts. Please wait a few minutes and try again.", firstName };
  }

  // Checked before an account is made, so a full or empty room makes none.
  const { problem } = await guestRoomProblem(code);
  if (problem) return { error: problem, firstName };

  const email = `rush-guest-${randomBytes(8).toString("hex")}@example.com`;
  const password = randomBytes(24).toString("hex");
  const user = await createAccount({ firstName, email, password, ageConfirmed: true, tosAccepted: true, privacyAccepted: true });
  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (err) {
    logEvent("AUTH_FAILURE", "Could not sign in a Rush guest account", { accountId: user.id, reason: err instanceof Error ? err.message : "unknown" });
    return { error: "Something went wrong. Press Join now again.", firstName };
  }

  let challengeId: string;
  try {
    challengeId = (await joinChallenge(user.id, code)).challengeId;
  } catch (err) {
    if (err instanceof RushError) return { error: "Someone else took the seat a moment ago. Ask for a new link.", firstName };
    throw err;
  }
  redirect(`/rush/live/${challengeId}`);
}
