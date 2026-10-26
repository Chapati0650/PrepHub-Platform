import Stripe from "stripe";
import { stripe, STRIPE_PRICE_IDS } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { logPaymentFailure } from "@/lib/logger";
import { hasPaidAccess } from "@/lib/entitlements";
import { BillingError } from "./errors";

export type Plan = "MONTHLY" | "ANNUAL";

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // PRD-003 §15

function priceIdForPlan(plan: Plan): string {
  return plan === "MONTHLY" ? STRIPE_PRICE_IDS.MONTHLY : STRIPE_PRICE_IDS.ANNUAL;
}

function planForPriceId(priceId: string | undefined): Plan | null {
  if (priceId === STRIPE_PRICE_IDS.MONTHLY) return "MONTHLY";
  if (priceId === STRIPE_PRICE_IDS.ANNUAL) return "ANNUAL";
  return null;
}

/**
 * Stripe's `status` stays "active" right up until a scheduled cancellation's
 * period actually ends — `cancel_at_period_end` is a separate flag — so "the
 * student cancelled but still has access" (our CANCELED) is derived here, not
 * a distinct Stripe status.
 */
export function mapStripeStatus(
  stripeStatus: Stripe.Subscription.Status,
  cancelAtPeriodEnd: boolean,
): "ACTIVE" | "CANCELED" | "PAST_DUE" | "EXPIRED" {
  if (stripeStatus === "active" || stripeStatus === "trialing") {
    return cancelAtPeriodEnd ? "CANCELED" : "ACTIVE";
  }
  if (stripeStatus === "past_due" || stripeStatus === "unpaid") {
    return "PAST_DUE";
  }
  return "EXPIRED"; // canceled, incomplete, incomplete_expired, paused
}

function currentPeriodEndOf(sub: Stripe.Subscription): Date | null {
  // Recent Stripe API versions moved current_period_end from the subscription
  // itself down to its line items.
  const item = sub.items.data[0];
  return item ? new Date(item.current_period_end * 1000) : null;
}

export async function createCheckoutSession(
  userId: string,
  plan: Plan,
  origin: string,
): Promise<string> {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new BillingError("STRIPE_NOT_CONFIGURED", "Billing isn't configured yet.");
  }

  // A second checkout is a second Stripe subscription billing the same
  // person: a back button, another tab, or a student whose school already
  // covers them. The database tracks one subscription per student, so the
  // other would keep charging with no way to cancel it from here. Anyone who
  // already has Premium is sent to manage what they have instead.
  if (await hasPaidAccess(userId)) {
    throw new BillingError("ALREADY_SUBSCRIBED", "You already have Premium. You can manage it from Billing.");
  }

  const existing = await prisma.subscription.findUnique({ where: { userId } });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceIdForPlan(plan), quantity: 1 }],
    client_reference_id: userId,
    // A complimentary row's customer id ("manual_comp_…") was never a Stripe
    // customer, and passing it would fail the checkout outright.
    customer: existing?.stripeCustomerId.startsWith("cus_") ? existing.stripeCustomerId : undefined,
    // Carried on the subscription itself so every later event about it can be
    // attributed to this account, even one that arrives before the checkout's
    // own completion event has created the Subscription row.
    subscription_data: { metadata: { userId } },
    allow_promotion_codes: true,
    success_url: `${origin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pricing`,
  });

  if (!session.url) {
    throw new BillingError("STRIPE_NOT_CONFIGURED", "Could not start checkout.");
  }
  return session.url;
}

/**
 * The single place that writes Stripe subscription state into our DB — called
 * from the webhook handler (source of truth in production) and from the
 * checkout-success page (this sandbox has no public URL for Stripe to reach,
 * so webhooks can't arrive here — see src/app/(app)/billing/success/page.tsx).
 * Upserts the full current state rather than incrementally mutating, so
 * repeated/duplicate delivery of the same event is naturally idempotent.
 */
export async function syncSubscriptionFromStripe(
  stripeSubscription: Stripe.Subscription,
  fallbackUserId?: string,
): Promise<void> {
  const customerId =
    typeof stripeSubscription.customer === "string"
      ? stripeSubscription.customer
      : stripeSubscription.customer.id;

  const plan = planForPriceId(stripeSubscription.items.data[0]?.price.id);
  const status = mapStripeStatus(stripeSubscription.status, stripeSubscription.cancel_at_period_end);
  const currentPeriodEnd = currentPeriodEndOf(stripeSubscription);

  const byCustomer = await prisma.subscription.findUnique({ where: { stripeCustomerId: customerId } });
  const userId = byCustomer?.userId ?? fallbackUserId ?? stripeSubscription.metadata?.userId;
  if (!userId) {
    // Never silent: a live subscription nobody can be matched to is someone
    // paying for access they don't have. Thrown so the webhook answers 500 and
    // Stripe retries, which also covers an update that simply arrived before
    // the checkout's completion event created the row.
    logPaymentFailure("Stripe subscription could not be attributed to an account", {
      affectedResourceId: stripeSubscription.id,
      errorType: `status ${stripeSubscription.status}`,
    });
    if (status !== "EXPIRED") throw new Error("Unattributed live Stripe subscription");
    return;
  }

  const existing = byCustomer?.userId === userId ? byCustomer : await prisma.subscription.findUnique({ where: { userId } });
  // A different subscription that has ended (a stray second checkout, an
  // old one being cleaned up) must not overwrite the one this student is
  // actually on.
  if (
    existing?.stripeSubscriptionId &&
    existing.stripeSubscriptionId !== stripeSubscription.id &&
    existing.status !== "EXPIRED" &&
    status === "EXPIRED"
  ) {
    return;
  }

  const wasPastDue = existing?.status === "PAST_DUE";
  const isPastDue = status === "PAST_DUE";
  const gracePeriodEndsAt = isPastDue
    ? wasPastDue
      ? (existing?.gracePeriodEndsAt ?? new Date(Date.now() + GRACE_PERIOD_MS))
      : new Date(Date.now() + GRACE_PERIOD_MS)
    : null;

  const data = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: stripeSubscription.id,
    plan,
    status,
    currentPeriodEnd,
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    gracePeriodEndsAt,
  };

  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });

  // PRD-003 §15: email notification the moment a payment failure starts the
  // grace period — not on every subsequent duplicate/retried webhook delivery.
  if (isPastDue && !wasPastDue) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      await sendEmail({
        to: user.email,
        subject: "We couldn't process your PrepHub payment",
        text: `Hi ${user.firstName},

Your last payment didn't go through. Nothing has been lost — your practice, your prediction and your streak are all exactly where you left them. You have 7 days to update your card before Personalized Practice pauses.

You can update it here:
${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/billing

If this is bad timing or something isn't working, reply to this and we'll figure it out.

— Prithvi, PrepHub`,
      }).catch(() => {});
    }
  }
}

export async function reconcileCheckoutSession(sessionId: string, expectedUserId: string): Promise<void> {
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });

  if (session.client_reference_id !== expectedUserId) {
    throw new BillingError(
      "NO_ACTIVE_SUBSCRIPTION",
      "This checkout session doesn't belong to your account.",
    );
  }
  const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
  if (!paid || !session.subscription || typeof session.subscription === "string") return;

  await syncSubscriptionFromStripe(session.subscription, expectedUserId);
}

/** PRD-003 §16 (triggered from district verification, not the billing UI):
 *  don't cancel outright — let the current period ride out. Best-effort
 *  against Stripe; the local DB write is what actually gates access, so a
 *  transient Stripe API failure here doesn't block the student's district
 *  access from activating. */
export async function scheduleSubscriptionNonRenewal(userId: string): Promise<void> {
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  if (!subscription?.stripeSubscriptionId || subscription.status !== "ACTIVE") return;

  try {
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  } catch (err) {
    logPaymentFailure("Failed to schedule Stripe subscription non-renewal", {
      accountId: userId,
      errorType: err instanceof Error ? err.message : String(err),
    });
  }

  await prisma.subscription.update({
    where: { userId },
    data: { status: "CANCELED", cancelAtPeriodEnd: true },
  });
}

/**
 * Account deletion: a deleted account can't sign in to reach Billing, so a
 * subscription left running would charge forever for access nobody can use.
 * Cancelled immediately rather than at period end for the same reason.
 * Best-effort against Stripe — deletion has already happened and must not be
 * undone by a Stripe outage — but the failure is logged so it can be finished
 * by hand.
 */
export async function cancelSubscriptionForDeletedAccount(userId: string): Promise<void> {
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  if (!subscription || subscription.status === "EXPIRED") return;

  if (subscription.stripeSubscriptionId) {
    try {
      await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
    } catch (err) {
      logPaymentFailure("Could not cancel a deleted account's Stripe subscription", {
        accountId: userId,
        affectedResourceId: subscription.stripeSubscriptionId,
        errorType: err instanceof Error ? err.message : String(err),
      });
    }
  }
  await prisma.subscription.update({
    where: { userId },
    data: { status: "EXPIRED", cancelAtPeriodEnd: false, gracePeriodEndsAt: null },
  });
}

export async function cancelSubscription(userId: string): Promise<void> {
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  if (!subscription?.stripeSubscriptionId || subscription.status !== "ACTIVE") {
    throw new BillingError(
      "SUBSCRIPTION_NOT_CANCELABLE",
      "There's no active subscription to cancel.",
    );
  }

  const updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: true,
  });
  await syncSubscriptionFromStripe(updated, userId);
}

export async function reactivateSubscription(userId: string): Promise<void> {
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  if (!subscription?.stripeSubscriptionId || subscription.status !== "CANCELED") {
    throw new BillingError(
      "NO_ACTIVE_SUBSCRIPTION",
      "There's no scheduled cancellation to reverse. Subscribe again from the pricing page.",
    );
  }

  const updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    cancel_at_period_end: false,
  });
  await syncSubscriptionFromStripe(updated, userId);
}

export async function switchPlan(userId: string, newPlan: Plan): Promise<void> {
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  if (
    !subscription?.stripeSubscriptionId ||
    (subscription.status !== "ACTIVE" && subscription.status !== "CANCELED")
  ) {
    throw new BillingError("NO_ACTIVE_SUBSCRIPTION", "There's no active subscription to switch.");
  }
  if (subscription.plan === newPlan) {
    throw new BillingError("SAME_PLAN", "You're already on this plan.");
  }

  const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
  const item = stripeSub.items.data[0];

  // No proration: the new price takes effect at the next renewal rather than
  // charging/crediting the difference right now — simpler and more honest to
  // disclose ("your plan changes on your next renewal date") than mid-cycle math.
  const updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    items: [{ id: item.id, price: priceIdForPlan(newPlan) }],
    proration_behavior: "none",
  });
  await syncSubscriptionFromStripe(updated, userId);
}

export async function applyPromoCode(userId: string, code: string): Promise<void> {
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  if (!subscription?.stripeSubscriptionId) {
    throw new BillingError("NO_ACTIVE_SUBSCRIPTION", "There's no subscription to apply a code to.");
  }

  const promos = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
  const promo = promos.data[0];
  if (!promo) {
    throw new BillingError("INVALID_PROMO_CODE", "That promo code isn't valid.");
  }

  const updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    discounts: [{ promotion_code: promo.id }],
  });
  await syncSubscriptionFromStripe(updated, userId);
}

/**
 * Webhook dispatcher. Only listens for the events that change subscription
 * state; everything funnels through syncSubscriptionFromStripe so there's one
 * code path computing our status, not one per event type.
 */
export async function handleStripeWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    // A delayed payment method (a bank debit) completes checkout unpaid and
    // reports the payment later, as async_payment_succeeded.
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (!session.client_reference_id || !session.subscription) break;
      const paid =
        session.payment_status === "paid" || session.payment_status === "no_payment_required";
      if (!paid) break;

      const subscriptionId =
        typeof session.subscription === "string" ? session.subscription : session.subscription.id;
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await syncSubscriptionFromStripe(subscription, session.client_reference_id);
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      // Stripe doesn't deliver events in order, and retries an old one after a
      // newer one has landed. Syncing from the event's own snapshot could put
      // a paid-up subscription back to past-due (and send the failed-payment
      // email after the payment succeeded), so the current state is fetched.
      const snapshot = event.data.object as Stripe.Subscription;
      const current = await stripe.subscriptions.retrieve(snapshot.id);
      await syncSubscriptionFromStripe(current);
      break;
    }
    default:
      break;
  }
}
