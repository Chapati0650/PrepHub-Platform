import { COLLEGE_APPS_ENABLED } from "@/lib/features";

/**
 * Prices as they are *shown*. What Stripe charges lives on the Price IDs in
 * STRIPE_PRICE_IDS, and nothing here is ever sent to checkout.
 *
 * In one place because several surfaces state a price — /pricing, Billing's
 * plan switch, and the moment a school's Premium switches on, which strikes
 * the annual price through (the Owner's request, 2026-10-24) — and they must
 * never disagree. Never on the landing page: that one carries no price at all
 * (Owner, 2026-09-21).
 */
export const ANNUAL_PRICE = "$99";
export const ANNUAL_PERIOD = "/year";
export const MONTHLY_PRICE = "$25";
export const MONTHLY_PERIOD = "/month";
// The Monthly plan's regular price, struck through beside the launch price
// (the Owner's launch-pricing decision). Annual has no "was" price because
// there isn't a real one to show.
export const MONTHLY_REGULAR_PRICE = "$50";

export type DisplayPlan = "MONTHLY" | "ANNUAL";

export const PLAN_NAME: Record<DisplayPlan, string> = { MONTHLY: "Monthly", ANNUAL: "Annual" };

const PLAN_PRICE: Record<DisplayPlan, string> = {
  MONTHLY: `${MONTHLY_PRICE}${MONTHLY_PERIOD}`,
  ANNUAL: `${ANNUAL_PRICE}${ANNUAL_PERIOD}`,
};

/** "Monthly · $25/month" — a plan as one label, for Billing and Settings. */
export function planLabel(plan: DisplayPlan): string {
  return `${PLAN_NAME[plan]} · ${PLAN_PRICE[plan]}`;
}

/** "$25/month", "$99/year". */
export function planPrice(plan: DisplayPlan): string {
  return PLAN_PRICE[plan];
}

/**
 * What Premium opens, as one phrase for every sentence that says what a
 * student keeps or loses — a failed payment, a cancellation. Those used to
 * name only Personalized Practice, which undersold what lapses and wasn't
 * true of the 800 Club, Rush or the Curriculum. Kept in step with the list on
 * /pricing; each item here is gated on hasPaidAccess.
 */
export const PREMIUM_INCLUDES = [
  "every Practice Set after the first",
  "Focused Practice",
  "the 800 Club",
  "starting a 1v1 Rush",
  ...(COLLEGE_APPS_ENABLED ? ["College Apps"] : []),
].join(", ") + " and the full Curriculum";

export type SubscriptionStatusValue = "ACTIVE" | "CANCELED" | "PAST_DUE" | "EXPIRED";

/**
 * A subscription's status in words. The enum values ("PAST_DUE", "CANCELED")
 * are storage names and used to be printed as they were. A cancellation is
 * reported as "Won't renew" rather than "Cancelled" because the student still
 * has Premium until the period ends, and "cancelled" reads as already gone.
 */
export function subscriptionStatusLabel(status: SubscriptionStatusValue, cancelAtPeriodEnd: boolean): string {
  switch (status) {
    case "ACTIVE":
      return cancelAtPeriodEnd ? "Won't renew" : "Active";
    case "CANCELED":
      return "Won't renew";
    case "PAST_DUE":
      return "Payment failed";
    case "EXPIRED":
      return "Ended";
  }
}
