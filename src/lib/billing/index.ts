import Stripe from "stripe";
import { stripe, STRIPE_PRICE_IDS } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { logPaymentFailure } from "@/lib/logger";
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

  const existing = await prisma.subscription.findUnique({ where: { userId } });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceIdForPlan(plan), quantity: 1 }],
    client_reference_id: userId,
    customer: existing?.stripeCustomerId,
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

  const existing = await prisma.subscription.findUnique({ where: { stripeCustomerId: customerId } });
  const userId = existing?.userId ?? fallbackUserId;
  if (!userId) return; // nothing we can attribute this Stripe object to

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
        text: `Your last payment didn't go through. You have 7 days to update your payment method before Personalized Practice access ends. Manage billing at ${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/billing.`,
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
    case "checkout.session.completed": {
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
      await syncSubscriptionFromStripe(event.data.object as Stripe.Subscription);
      break;
    }
    default:
      break;
  }
}
