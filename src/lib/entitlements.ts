import { prisma } from "@/lib/prisma";

/**
 * PRD-017 §12: the one and only place paid-feature access is decided.
 * No other module may implement its own subscription/school-access check.
 *
 *   hasPaidAccess = hasActiveIndividualSubscription OR hasActiveSchoolEntitlement
 *     OR (PRD-011 §7) the user is a School Administrator, always
 */
export async function hasPaidAccess(userId: string): Promise<boolean> {
  const [user, subscription, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    prisma.subscription.findUnique({ where: { userId } }),
    prisma.studentMembership.findUnique({
      where: { studentId: userId },
      include: { organization: true },
    }),
  ]);

  // PRD-011 §7: an Administrator "can use the full PrepHub student experience
  // for testing and evaluation" — unconditionally, not tied to their own
  // school's contract/billing status, since they have neither a subscription
  // nor a StudentMembership of their own to check.
  if (user?.role === "SCHOOL_ADMINISTRATOR") return true;

  return (
    hasActiveIndividualSubscription(subscription) || hasActiveSchoolEntitlement(membership)
  );
}

type SubscriptionRow = Awaited<ReturnType<typeof prisma.subscription.findUnique>>;

function hasActiveIndividualSubscription(subscription: SubscriptionRow): boolean {
  if (!subscription) return false;
  const now = new Date();

  if (subscription.status === "ACTIVE") return true;

  // PRD-003: cancellation keeps access until the period ends.
  if (
    subscription.status === "CANCELED" &&
    subscription.currentPeriodEnd &&
    subscription.currentPeriodEnd > now
  ) {
    return true;
  }

  // PRD-003: a failed payment gets a 7-day grace period before access lapses.
  if (
    subscription.status === "PAST_DUE" &&
    subscription.gracePeriodEndsAt &&
    subscription.gracePeriodEndsAt > now
  ) {
    return true;
  }

  return false;
}

type MembershipRow = Awaited<
  ReturnType<
    typeof prisma.studentMembership.findUnique<{
      where: { studentId: string };
      include: { organization: true };
    }>
  >
>;

function hasActiveSchoolEntitlement(membership: MembershipRow): boolean {
  if (!membership) return false;
  if (membership.status !== "ACTIVE") return false;
  if (membership.organization.status !== "ACTIVE") return false;

  const now = new Date();

  // PRD-017 §16.1/§16.2: checked directly rather than trusting `status` alone
  // to have been flipped in time — there's no scheduled job yet that expires
  // an Organization the moment its contract end date passes, so a stale
  // ACTIVE status shouldn't be enough on its own to grant access.
  if (membership.organization.contractStartDate > now) return false;
  if (membership.organization.contractEndDate <= now) return false;

  // PRD-017 §10: access ends July 1 of the expected graduation year.
  const graduationCutoff = new Date(
    Date.UTC(membership.expectedGraduationYear, 6, 1), // July = month 6
  );
  return now < graduationCutoff;
}

export type AccessSummary =
  | { type: "SCHOOL"; organizationName: string }
  | { type: "INDIVIDUAL"; subscription: NonNullable<SubscriptionRow> }
  | { type: "NONE" };

// PRD-010 §9 — Settings needs to distinguish *why* a student has (or lacks)
// paid access, not just the hasPaidAccess boolean. Built from the same
// private helpers as hasPaidAccess so this stays the one place that logic
// lives, per PRD-017 §12 — no separate re-derivation.
export async function getAccessSummary(userId: string): Promise<AccessSummary> {
  const [subscription, membership] = await Promise.all([
    prisma.subscription.findUnique({ where: { userId } }),
    prisma.studentMembership.findUnique({
      where: { studentId: userId },
      include: { organization: true },
    }),
  ]);

  if (hasActiveSchoolEntitlement(membership)) {
    return { type: "SCHOOL", organizationName: membership!.organization.officialName };
  }
  if (hasActiveIndividualSubscription(subscription)) {
    return { type: "INDIVIDUAL", subscription: subscription! };
  }
  return { type: "NONE" };
}
