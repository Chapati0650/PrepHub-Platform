import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { OnboardingWizard } from "./onboarding-wizard";

// Shown once, right after signup, before access selection — a short quiz
// (grade/target score/study commitment) that personalizes the product before
// the student ever has to decide how to pay for it. Never shown to
// OWNER/SCHOOL_ADMINISTRATOR (they never sign up through this path) or to a
// student who's already completed it.
export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "STUDENT") redirect("/home");

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { onboardingCompletedAt: true },
  });
  if (user.onboardingCompletedAt) redirect("/home");

  return <OnboardingWizard />;
}
