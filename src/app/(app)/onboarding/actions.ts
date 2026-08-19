"use server";

import { redirect } from "next/navigation";
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

  redirect("/access");
}
