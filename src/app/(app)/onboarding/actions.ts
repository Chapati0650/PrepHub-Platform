"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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

  const enrollment = await completeOnboarding(session.user.id, {
    grade: parsed.grade,
    targetScore: parsed.targetScoreMidpoint,
    studyCommitment: parsed.studyCommitment,
  });

  // A district student enrolled a moment ago, inside this same action. Without
  // this the shell rendered for the redirect below still carries the pre-
  // enrollment answer and shows "Upgrade · 50% off" in the sidebar beside a
  // dashboard full of paid access — confirmed in a browser, and it cleared on
  // the next reload, which is exactly the kind of bug that never shows up in a
  // unit test. Revalidating the layout makes the first screen correct.
  if (enrollment === "CREATED") revalidatePath("/", "layout");

  // To the dashboard, which shows the Begin Diagnostic card with the rest
  // of the app around it — a new student can start the Diagnostic or look
  // around first (Owner, 2026-09-21). Not /access: the school-vs-individual
  // chooser is hidden at launch, which made it a $25/month card shown to a
  // brand-new student before they'd seen anything.
  redirect("/home");
}
