import { prisma } from "@/lib/prisma";
import type { StudyCommitment } from "@/generated/prisma/client";
import { ensureDistrictMembership } from "@/lib/district/enrollment";
import { logEvent } from "@/lib/logger";

export type CompleteOnboardingInput = {
  grade: number;
  targetScore: number | null;
  studyCommitment: StudyCommitment;
};

export async function completeOnboarding(userId: string, input: CompleteOnboardingInput): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      grade: input.grade,
      targetScore: input.targetScore,
      studyCommitment: input.studyCommitment,
      onboardingCompletedAt: new Date(),
    },
  });

  // This is the first moment a district student can be enrolled: the
  // membership needs a grade, and this step is what collects it. Doing it
  // here means they reach /home already carrying school access, so they
  // never see an upgrade prompt at all.
  //
  // Best-effort by design (CLAUDE.md: optional side effects must never block
  // or fail the core operation). If it fails, the student still finished
  // onboarding, and the lazy call on /home picks them up on the next render.
  try {
    await ensureDistrictMembership(userId);
  } catch (err) {
    logEvent("SCHOOL_VERIFICATION_FAILURE", "District auto-enrollment failed after onboarding", {
      accountId: userId,
      reason: err instanceof Error ? err.message : "unknown",
    });
  }
}
