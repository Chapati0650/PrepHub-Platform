import { prisma } from "@/lib/prisma";

/**
 * PRD-011 §7 — a School Administrator account can use the entire student
 * product (diagnostic, practice, dashboard, progress, community, settings)
 * exactly as a student would, "to test and understand the student experience."
 * Every page/action gated to "students only" must use this, not a bare
 * `role === "STUDENT"` check, or Administrators get locked out of §7's
 * required feature. Their activity is still excluded from every school
 * aggregate — not via a role filter here, but structurally: those aggregates
 * are scoped by `StudentMembership` rows, which Administrators never have
 * (they have `AdministratorAssignment` instead).
 */
export function canUseStudentExperience(role: string | undefined): boolean {
  return role === "STUDENT" || role === "SCHOOL_ADMINISTRATOR";
}

/**
 * PRD-002 §5.1: the access-selection page is shown to a student who has never
 * chosen an access method — not to one whose access later lapsed (that's a
 * different state, handled where paid features are gated, not here).
 */
export async function needsAccessSelection(userId: string): Promise<boolean> {
  const [subscription, membership] = await Promise.all([
    prisma.subscription.findUnique({ where: { userId } }),
    prisma.studentMembership.findUnique({ where: { studentId: userId } }),
  ]);
  return !subscription && !membership;
}
