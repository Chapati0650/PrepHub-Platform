import { cache } from "react";
import { prisma } from "@/lib/prisma";

/**
 * PRD-017 §12: the one and only place paid-feature access is decided.
 * No other module may implement its own subscription/school-access check.
 *
 *   hasPaidAccess = hasActiveIndividualSubscription OR hasActiveSchoolEntitlement
 *     OR (PRD-011 §7) the user is a School Administrator, always
 */
/**
 * The three rows every access decision is made from, fetched once per request.
 *
 * The app layout calls `hasPaidAccess` on every authenticated render, and the
 * dashboard then needed the same membership and subscription rows for its own
 * display — so each page view fetched both twice. Both now read this, and
 * because it is React-cached the second reader pays nothing. Measured on
 * /home: 25 queries down to 22.
 */
async function loadAccessContext(userId: string) {
  const [user, subscription, membership] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      // email/emailVerified ride along for district domain enrollment, which
      // runs on the same render and would otherwise re-read this row.
      select: { role: true, email: true, emailVerified: true },
    }),
    prisma.subscription.findUnique({ where: { userId } }),
    prisma.studentMembership.findUnique({
      where: { studentId: userId },
      include: { organization: true },
    }),
  ]);
  return { user, subscription, membership };
}

type AccessContext = Awaited<ReturnType<typeof loadAccessContext>>;

// React `cache` memoizes a mutable box rather than the promise itself, which
// is what makes the memo invalidatable. District enrollment can create a
// membership midway through a render, and without this the rest of that
// render would keep seeing the student as unenrolled — which showed up as an
// "Upgrade" row in the sidebar next to a page full of paid content.
const accessBox = cache((userId: string) => {
  void userId; // the memo key; React caches one box per user per request
  return { value: null as Promise<AccessContext> | null };
});

export async function getAccessContext(userId: string): Promise<AccessContext> {
  const box = accessBox(userId);
  box.value ??= loadAccessContext(userId);
  return box.value;
}

/** Drops the memo after a write that changes the answer, within one request. */
export function invalidateAccessContext(userId: string): void {
  accessBox(userId).value = null;
}

export async function hasPaidAccess(userId: string): Promise<boolean> {
  const { user, subscription, membership } = await getAccessContext(userId);
  return decidePaidAccess(user?.role ?? null, subscription, membership);
}

/**
 * The decision itself, with no database access — so a page that has already
 * loaded the role, subscription and membership can reach the same verdict
 * without a second round trip. `hasPaidAccess` above is the fetching wrapper
 * and stays the default; this exists because the dashboard was issuing three
 * duplicate queries per render (2026-09-28). Callers must pass rows loaded
 * the same way `hasPaidAccess` loads them — in particular a membership with
 * its `organization` included — and the entitlement rule still lives in
 * exactly one place, which is the invariant that matters (PRD-017 §12).
 */
export function decidePaidAccess(
  role: string | null,
  subscription: SubscriptionRow,
  membership: MembershipRow,
): boolean {
  // PRD-011 §7: an Administrator "can use the full PrepHub student experience
  // for testing and evaluation" — unconditionally, not tied to their own
  // school's contract/billing status, since they have neither a subscription
  // nor a StudentMembership of their own to check.
  if (role === "SCHOOL_ADMINISTRATOR") return true;

  return (
    hasActiveIndividualSubscription(subscription) || hasActiveSchoolEntitlement(membership)
  );
}

export type SubscriptionRow = Awaited<ReturnType<typeof prisma.subscription.findUnique>>;

// Exported (not just used internally) so bulk/list views — e.g. the Owner's
// platform-wide user directory — can reapply this exact rule in-memory over
// a single batched query instead of either N+1-calling hasPaidAccess per
// user or re-deriving the threshold logic themselves, which PRD-017 §12
// forbids. Still the one place the rule itself is defined.
export function hasActiveIndividualSubscription(subscription: SubscriptionRow): boolean {
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

export type MembershipRow = Awaited<
  ReturnType<
    typeof prisma.studentMembership.findUnique<{
      where: { studentId: string };
      include: { organization: true };
    }>
  >
>;

export function hasActiveSchoolEntitlement(membership: MembershipRow): boolean {
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
  // Same two rows hasPaidAccess reads, via the shared cached loader — Settings
  // renders inside the app layout, which has already fetched them.
  const { subscription, membership } = await getAccessContext(userId);

  if (hasActiveSchoolEntitlement(membership)) {
    return { type: "SCHOOL", organizationName: membership!.organization.officialName };
  }
  if (hasActiveIndividualSubscription(subscription)) {
    return { type: "INDIVIDUAL", subscription: subscription! };
  }
  return { type: "NONE" };
}
