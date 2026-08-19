import { prisma } from "@/lib/prisma";
import type { StudyCommitment } from "@/generated/prisma/client";

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
}
