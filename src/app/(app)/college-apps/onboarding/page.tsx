import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { COLLEGE_APPS_ENABLED } from "@/lib/features";
import { canUseStudentExperience } from "@/lib/access";
import { hasPaidAccess } from "@/lib/entitlements";
import { prisma } from "@/lib/prisma";
import { getProfile } from "@/lib/college-apps/tracker";
import { CollegeOnboardingWizard } from "./college-onboarding-wizard";

export default async function CollegeOnboardingPage() {
  // Hidden from the student experience (src/lib/features.ts). Redirect rather
  // than 404 so a link already shared still lands somewhere sensible; the
  // tracker data is untouched and returns intact when the flag flips.
  if (!COLLEGE_APPS_ENABLED) redirect("/home");

  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");
  if (!(await hasPaidAccess(session.user.id))) redirect("/college-apps");

  // Reopening the wizard from the tracker ("change grade or platforms") is
  // allowed; it prefills the grade from the profile or, failing that, the
  // grade the SAT onboarding already collected.
  const [profile, user] = await Promise.all([
    getProfile(session.user.id),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { grade: true } }),
  ]);
  return <CollegeOnboardingWizard initialGrade={profile?.grade ?? user?.grade ?? null} />;
}
