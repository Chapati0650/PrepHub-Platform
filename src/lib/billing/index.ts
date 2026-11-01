import Stripe from "stripe";
import { stripe, STRIPE_PRICE_IDS } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { logPaymentFailure } from "@/lib/logger";
import { hasPaidAccess } from "@/lib/entitlements";
import { formatLongLocalDate } from "@/lib/community/local-day";
import { BillingError } from "./errors";
import { PLAN_NAME, PREMIUM_INCLUDES } from "./display";

export type Plan = "MONTHLY" | "ANNUAL";

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // PRD-003 §15

// Marks a Subscription Schedule as one switchPlan made, so it is the only kind
// this code will rewrite or release on a student's say-so. A schedule set up
// by hand in the Stripe dashboard (a comp, a custom arrangement) is left alone.
const SCHEDULE_PURPOSE_KEY = "prephub";
const SCHEDULE_PURPOSE = "plan_switch";

const CANT_SWITCH_ONLINE =
  "Your plan can't be switched online right now, and nothing about it has changed. " +
  "Reply to any PrepHub email and we'll switch it for you.";

function priceIdForPlan(plan: Plan): string {
  return plan === "MONTHLY" ? STRIPE_PRICE_IDS.MONTHLY : STRIPE_PRICE_IDS.ANNUAL;
}

function planForPriceId(priceId: string | undefined): Plan | null {
  if (priceId === STRIPE_PRICE_IDS.MONTHLY) return "MONTHLY";
  if (priceId === STRIPE_PRICE_IDS.ANNUAL) return "ANNUAL";
  return null;
}

function idOf(value: string | { id: string }): string {
  return typeof value === "string" ? value : value.id;
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

// ---- Subscription Schedules (plan switches) ---------------------------------

type SchedulePhase = Stripe.SubscriptionSchedule.Phase;
type SchedulePhaseParam = Stripe.SubscriptionScheduleUpdateParams.Phase;
type PhaseDiscountParam = Stripe.SubscriptionScheduleUpdateParams.Phase.Discount;

/** The schedule managing this subscription, if one still is. */
async function attachedSchedule(sub: Stripe.Subscription): Promise<Stripe.SubscriptionSchedule | null> {
  if (!sub.schedule) return null;
  const schedule = typeof sub.schedule === "string" ? await stripe.subscriptionSchedules.retrieve(sub.schedule) : sub.schedule;
  return schedule.status === "active" || schedule.status === "not_started" ? schedule : null;
}

/** The phase running now and every one after it, in order. Past phases can't be rewritten and aren't sent back. */
function phasesFromCurrent(schedule: Stripe.SubscriptionSchedule): SchedulePhase[] {
  const now = schedule.current_phase;
  if (!now) return [];
  return schedule.phases.filter((p) => p.start_date >= now.start_date).sort((a, b) => a.start_date - b.start_date);
}

/**
 * The plan a schedule moves the subscription to when its current phase ends,
 * if that is a different plan from the one it's on. This is what Billing
 * shows as "Switches to Annual on …". Pure.
 */
export function scheduledPlanChange(
  schedule: Stripe.SubscriptionSchedule,
  currentPlan: Plan | null,
): { plan: Plan; startsAt: Date } | null {
  if (schedule.status !== "active" || !schedule.current_phase) return null;
  const endsAt = schedule.current_phase.end_date;
  const next = schedule.phases.find((p) => p.start_date === endsAt);
  if (!next || next.items.length !== 1) return null;
  const plan = planForPriceId(idOf(next.items[0].price));
  if (!plan || plan === currentPlan) return null;
  return { plan, startsAt: new Date(next.start_date * 1000) };
}

/**
 * Whether switchPlan may rewrite this schedule: one it made itself, or one with
 * nothing planned beyond the price the subscription is already on (a schedule
 * just created from the subscription mirrors it exactly, so rewriting it loses
 * nothing). Anything else carries someone's deliberate future phases.
 */
function isRewritable(schedule: Stripe.SubscriptionSchedule, currentPriceId: string): boolean {
  if (schedule.metadata?.[SCHEDULE_PURPOSE_KEY] === SCHEDULE_PURPOSE) return true;
  const upcoming = phasesFromCurrent(schedule);
  return upcoming.length === 1 && upcoming[0].items.length === 1 && idOf(upcoming[0].items[0].price) === currentPriceId;
}

// A phase reports its discounts with all three fields and two of them null;
// the update takes exactly one. An existing discount is reused by id, which
// keeps its remaining duration rather than starting the coupon over.
function discountParam(d: Stripe.SubscriptionSchedule.Phase.Discount): PhaseDiscountParam[] {
  if (d.discount) return [{ discount: idOf(d.discount) }];
  if (d.coupon) return [{ coupon: idOf(d.coupon) }];
  if (d.promotion_code) return [{ promotion_code: idOf(d.promotion_code) }];
  return [];
}

/**
 * A phase as it already is, in the shape an update takes. Updating a schedule
 * replaces every phase from the current one on, so anything not sent back is
 * dropped — the current phase's discounts most of all, which would otherwise
 * come off the live subscription the moment a switch is scheduled.
 */
function samePhase(phase: SchedulePhase, first: boolean, discounts?: PhaseDiscountParam[]): SchedulePhaseParam {
  const kept = discounts ?? phase.discounts.flatMap(discountParam);
  return {
    ...(first ? { start_date: phase.start_date } : {}),
    end_date: phase.end_date,
    items: phase.items.map((i) => ({ price: idOf(i.price), quantity: i.quantity ?? 1 })),
    ...(kept.length > 0 ? { discounts: kept } : {}),
    ...(phase.metadata ? { metadata: phase.metadata } : {}),
    proration_behavior: phase.proration_behavior,
  };
}

/**
 * The current price until the current phase ends — which is the subscription's
 * renewal date — then the new price for one billing period, after which the
 * schedule releases and the subscription simply carries on with it. The new
 * phase starts exactly at the old period's end, so there is nothing to prorate
 * and the first charge on the new plan is on the date the old plan would have
 * renewed. Discounts move across with it.
 */
function switchPhases(current: SchedulePhase, newPlan: Plan, userId: string): SchedulePhaseParam[] {
  const discounts = current.discounts.flatMap(discountParam);
  const metadata = { ...(current.metadata ?? {}), userId };
  return [
    { ...samePhase(current, true), metadata },
    {
      items: [{ price: priceIdForPlan(newPlan), quantity: current.items[0]?.quantity ?? 1 }],
      ...(discounts.length > 0 ? { discounts } : {}),
      metadata,
      duration: { interval: newPlan === "ANNUAL" ? "year" : "month", interval_count: 1 },
      proration_behavior: "none",
    },
  ];
}

/**
 * Lets go of a schedule before anything that ends the subscription: Stripe
 * refuses to change a scheduled subscription's cancellation directly.
 * Releasing drops any switch still waiting and leaves the subscription exactly
 * as it is now.
 */
async function releaseSchedule(sub: Stripe.Subscription): Promise<void> {
  const schedule = await attachedSchedule(sub);
  if (schedule) await stripe.subscriptionSchedules.release(schedule.id);
}

// ---- Checkout -----------------------------------------------------------------

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
 *
 * A pending plan switch is part of that state: it is read from the
 * subscription's schedule (fetched when the subscription only names it), so
 * the row never claims a switch Stripe won't make or misses one it will.
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

  // An ending subscription has no switch to make; one that's still running may.
  const pending =
    status === "ACTIVE" || status === "PAST_DUE"
      ? await attachedSchedule(stripeSubscription).then((s) => (s ? scheduledPlanChange(s, plan) : null))
      : null;

  const isPastDue = status === "PAST_DUE";
  const graceStartsNow = new Date(Date.now() + GRACE_PERIOD_MS);

  const data = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: stripeSubscription.id,
    plan,
    status,
    currentPeriodEnd,
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    pendingPlan: pending?.plan ?? null,
    pendingPlanStartsAt: pending?.startsAt ?? null,
  };

  // PRD-003 §15: the failed-payment email goes out once, the moment the grace
  // period starts. Deciding that from the row read above let two deliveries
  // arriving together (Stripe sends `invoice.payment_failed` and
  // `customer.subscription.updated` within the same second) both see "not past
  // due yet" and both send. The move into PAST_DUE is claimed instead — an
  // update conditioned on the row not already being past due, which Postgres
  // re-checks after waiting on a concurrent writer — and only the call whose
  // claim changed a row sends. Claim and upsert share a transaction so a
  // failed upsert can't leave a claimed row that never got its email.
  const enteredPastDue = await prisma.$transaction(async (tx) => {
    const claimed = isPastDue
      ? (
          await tx.subscription.updateMany({
            where: { userId, status: { not: "PAST_DUE" } },
            data: { status: "PAST_DUE", gracePeriodEndsAt: graceStartsNow },
          })
        ).count > 0
      : false;
    // A past-due row keeps the grace period it has (set by the claim, now or
    // on an earlier delivery), so a repeat never restarts the 7-day clock.
    // Only a row that is somehow past due without one is given one.
    const missingGrace = existing?.status === "PAST_DUE" && !existing.gracePeriodEndsAt;
    await tx.subscription.upsert({
      where: { userId },
      create: { userId, ...data, gracePeriodEndsAt: isPastDue ? graceStartsNow : null },
      update: isPastDue
        ? { ...data, ...(missingGrace ? { gracePeriodEndsAt: graceStartsNow } : {}) }
        : { ...data, gracePeriodEndsAt: null },
    });
    return claimed;
  });

  if (enteredPastDue) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      await sendEmail({
        to: user.email,
        subject: "We couldn't process your PrepHub payment",
        text: `Hi ${user.firstName},

Your last payment didn't go through. Nothing has been lost — your practice, your prediction and your streak are all exactly where you left them. You have 7 days to update your card before Premium pauses (${PREMIUM_INCLUDES}).

You can update it here:
${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/billing

If this is bad timing or something isn't working, reply to this and we'll figure it out.

— Prithvi, PrepHub`,
      }).catch(() => {});
    }
  }
}

/**
 * The success page's own reconciliation. "PROCESSING" is a checkout that
 * completed without the money arriving yet — a bank debit settles days later
 * and reports itself through `checkout.session.async_payment_succeeded` — so
 * the page must not say the subscription is active.
 */
export async function reconcileCheckoutSession(sessionId: string, expectedUserId: string): Promise<"ACTIVE" | "PROCESSING"> {
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });

  if (session.client_reference_id !== expectedUserId) {
    throw new BillingError(
      "NO_ACTIVE_SUBSCRIPTION",
      "This checkout session doesn't belong to your account.",
    );
  }
  const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
  if (!paid || !session.subscription) return "PROCESSING";

  const subscription =
    typeof session.subscription === "string"
      ? await stripe.subscriptions.retrieve(session.subscription)
      : session.subscription;
  await syncSubscriptionFromStripe(subscription, expectedUserId);
  return mapStripeStatus(subscription.status, subscription.cancel_at_period_end) === "EXPIRED" ? "PROCESSING" : "ACTIVE";
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
    // A plan switch still waiting would otherwise block the cancellation, and
    // there's nothing to switch to once the school is paying.
    await releaseSchedule(await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId));
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
    data: { status: "CANCELED", cancelAtPeriodEnd: true, pendingPlan: null, pendingPlanStartsAt: null },
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
      await releaseSchedule(await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId));
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
    data: {
      status: "EXPIRED",
      cancelAtPeriodEnd: false,
      gracePeriodEndsAt: null,
      pendingPlan: null,
      pendingPlanStartsAt: null,
    },
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

  // Cancelling also drops a plan switch that was waiting for the renewal —
  // there won't be a renewal — and Stripe won't cancel a scheduled
  // subscription until its schedule lets go of it.
  await releaseSchedule(await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId));
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

export type PlanSwitchResult =
  | { kind: "SCHEDULED"; plan: Plan; startsAt: Date }
  | { kind: "KEPT"; plan: Plan };

/**
 * Monthly ↔ Annual, taking effect at the next renewal — what Billing promises
 * ("nothing is charged today"). It used to change the price in place with
 * proration off, but the two plans bill on different intervals, and changing
 * the interval makes Stripe restart the billing cycle and invoice the new
 * price immediately, with no credit for the time already paid: $99 the day a
 * monthly student switched, or $25 and the rest of a paid year forfeited the
 * other way. A Subscription Schedule is Stripe's way to say "this price until
 * the period ends, then that one".
 *
 * Asking for the plan the student is already on cancels a switch that's
 * waiting (the schedule is released and the subscription carries on
 * untouched). A subscription set to end is refused rather than having its
 * cancellation quietly undone: switching means renewing, and the student said
 * they didn't want to renew — reactivating is a separate, explicit choice.
 *
 * Not yet exercised against real Stripe (no keys in the dev sandbox); covered
 * by unit tests against a mocked client.
 */
export async function switchPlan(userId: string, newPlan: Plan): Promise<PlanSwitchResult> {
  const subscription = await prisma.subscription.findUnique({ where: { userId } });
  // A complimentary row was never a Stripe subscription, so there is nothing
  // in Stripe to switch.
  if (!subscription?.stripeSubscriptionId?.startsWith("sub_")) {
    throw new BillingError("NO_ACTIVE_SUBSCRIPTION", "There's no active subscription to switch.");
  }
  const subscriptionId = subscription.stripeSubscriptionId;

  // The row can trail Stripe, so the decision is made from Stripe's own
  // state, and the row is brought up to date with it on the way.
  const stripeSub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["schedule"] });
  await syncSubscriptionFromStripe(stripeSub, userId);

  const status = mapStripeStatus(stripeSub.status, stripeSub.cancel_at_period_end);
  if (status === "CANCELED" || stripeSub.cancel_at) {
    const endsOn = currentPeriodEndOf(stripeSub);
    const when = endsOn ? ` on ${formatLongLocalDate(endsOn)}` : "";
    throw new BillingError(
      "SUBSCRIPTION_ENDING",
      `Your subscription is set to end${when}. To keep Premium on a different plan, reactivate it first, then switch.`,
    );
  }
  if (status !== "ACTIVE") {
    throw new BillingError("NO_ACTIVE_SUBSCRIPTION", "There's no active subscription to switch.");
  }

  const item = stripeSub.items.data[0];
  const currentPlan = planForPriceId(item?.price.id);
  // Item-level discounts can't be carried onto a different price reliably,
  // and losing one at renewal would be a silent price rise. PrepHub never
  // makes them (checkout and promo codes discount the subscription), so this
  // is a subscription someone set up by hand.
  if (!item || !currentPlan || stripeSub.items.data.length !== 1 || (item.discounts?.length ?? 0) > 0) {
    throw new BillingError("PLAN_CHANGE_UNAVAILABLE", CANT_SWITCH_ONLINE);
  }

  const schedule = await attachedSchedule(stripeSub);
  if (schedule && !isRewritable(schedule, item.price.id)) {
    throw new BillingError("PLAN_CHANGE_UNAVAILABLE", CANT_SWITCH_ONLINE);
  }
  const pending = schedule ? scheduledPlanChange(schedule, currentPlan) : null;

  if (newPlan === currentPlan && !pending) {
    throw new BillingError("SAME_PLAN", "You're already on this plan.");
  }
  if (pending?.plan === newPlan) {
    throw new BillingError(
      "SWITCH_ALREADY_SCHEDULED",
      `Your switch to ${PLAN_NAME[newPlan]} is already scheduled for ${formatLongLocalDate(pending.startsAt)}.`,
    );
  }

  let result: PlanSwitchResult;
  let created: Stripe.SubscriptionSchedule | null = null;
  try {
    if (newPlan === currentPlan) {
      await stripe.subscriptionSchedules.release(schedule!.id);
      result = { kind: "KEPT", plan: currentPlan };
    } else {
      // Stripe asks for two calls: a schedule created from a subscription
      // can't be given phases in the same request.
      const target = schedule ?? (created = await stripe.subscriptionSchedules.create({ from_subscription: subscriptionId }));
      const current = phasesFromCurrent(target)[0];
      if (!current) throw new BillingError("PLAN_CHANGE_UNAVAILABLE", CANT_SWITCH_ONLINE);
      await stripe.subscriptionSchedules.update(target.id, {
        end_behavior: "release",
        proration_behavior: "none",
        metadata: { [SCHEDULE_PURPOSE_KEY]: SCHEDULE_PURPOSE, userId },
        phases: switchPhases(current, newPlan, userId),
      });
      result = { kind: "SCHEDULED", plan: newPlan, startsAt: new Date(current.end_date * 1000) };
    }
  } catch (err) {
    // A schedule created a moment ago only mirrors the subscription, so
    // releasing it puts everything back as it was.
    if (created) {
      await stripe.subscriptionSchedules.release(created.id).catch(() => {});
    }
    if (err instanceof BillingError) throw err;
    logPaymentFailure("Plan switch failed", {
      accountId: userId,
      affectedResourceId: subscriptionId,
      errorType: err instanceof Error ? err.message : String(err),
    });
    throw new BillingError(
      "PLAN_CHANGE_FAILED",
      "We couldn't change your plan just now, and nothing about it has changed. Please try again in a minute.",
    );
  }

  const fresh = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["schedule"] });
  await syncSubscriptionFromStripe(fresh, userId);
  return result;
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

  // With a plan switch waiting, the schedule decides what the subscription
  // looks like from the renewal on, so a discount put on the subscription
  // alone would come off at the switch. It goes on every phase instead.
  const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId, { expand: ["schedule"] });
  const schedule = await attachedSchedule(stripeSub);
  const item = stripeSub.items.data[0];
  let updated: Stripe.Subscription;
  if (schedule && item && isRewritable(schedule, item.price.id)) {
    await stripe.subscriptionSchedules.update(schedule.id, {
      proration_behavior: "none",
      phases: phasesFromCurrent(schedule).map((p, i) => samePhase(p, i === 0, [{ promotion_code: promo.id }])),
    });
    updated = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId, { expand: ["schedule"] });
  } else {
    updated = await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      discounts: [{ promotion_code: promo.id }],
    });
  }
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
    // A schedule edited or released from the Stripe dashboard changes the
    // pending switch without necessarily touching the subscription itself.
    // Only arrives if the endpoint is subscribed to these events; the
    // subscription events above already cover a schedule attaching or letting go.
    case "subscription_schedule.updated":
    case "subscription_schedule.released":
    case "subscription_schedule.canceled":
    case "subscription_schedule.completed": {
      const schedule = event.data.object as Stripe.SubscriptionSchedule;
      const subscriptionId = schedule.subscription ? idOf(schedule.subscription) : schedule.released_subscription;
      if (!subscriptionId) break;
      const current = await stripe.subscriptions.retrieve(subscriptionId);
      await syncSubscriptionFromStripe(current);
      break;
    }
    default:
      break;
  }
}
