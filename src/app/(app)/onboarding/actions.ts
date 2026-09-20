"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { RUSH_JOIN_COOKIE } from "@/lib/rush/join-cookie";
import { readPendingRushCode } from "@/lib/rush/pending-join";
import { z } from "zod";
import { auth } from "@/auth";
import { completeOnboarding } from "@/lib/onboarding/complete-onboarding";
import { ONBOARDING_SCORE_RANGES } from "@/lib/onboarding/target-score-options";

const MIDPOINTS = new Set(ONBOARDING_SCORE_RANGES.map((r) => r.midpoint));

const completeOnboardingSchema = z.object({
  grade: z.number().int().min(9).max(12),
  targetScoreMidpoint: z.number().int().nullable(),
  studyCommitment: z.enum(["LIGHT", "MODERATE", "INTENSIVE", "FEW_TIMES_WEEK", "UNSURE"]),
});

export type CompleteOnboardingActionInput = z.infer<typeof completeOnboardingSchema>;

export async function completeOnboardingAction(input: CompleteOnboardingActionInput): Promise<void> {
  const session = await auth();
  if (!session?.user || session.user.role !== "STUDENT") redirect("/home");

  const parsed = completeOnboardingSchema.parse(input);
  // Target score must be exactly one of the 15 SCORE_RANGES midpoints (or
  // null for "not sure") — the wizard only ever offers those as choices.
  if (parsed.targetScoreMidpoint !== null && !MIDPOINTS.has(parsed.targetScoreMidpoint)) {
    throw new Error("Invalid target score");
  }

  await completeOnboarding(session.user.id, {
    grade: parsed.grade,
    targetScore: parsed.targetScoreMidpoint,
    studyCommitment: parsed.studyCommitment,
  });

  // Signed up from a friend's 1v1 Rush link (see middleware.ts): the
  // challenge comes before the access chooser — accepting it is free, and
  // it's the reason this account exists. Cleared here (a Server Action may
  // write cookies; the page that reads it may not) so nothing redirects to
  // it twice.
  const pendingRushCode = await readPendingRushCode();
  if (pendingRushCode) {
    (await cookies()).delete(RUSH_JOIN_COOKIE);
    redirect(`/rush/join/${pendingRushCode}`);
  }

  redirect("/access");
}
