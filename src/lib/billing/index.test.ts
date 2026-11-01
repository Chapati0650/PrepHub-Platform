import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  mapStripeStatus,
  createCheckoutSession,
  syncSubscriptionFromStripe,
  reconcileCheckoutSession,
  scheduleSubscriptionNonRenewal,
  cancelSubscriptionForDeletedAccount,
  cancelSubscription,
  reactivateSubscription,
  scheduledPlanChange,
  switchPlan,
  applyPromoCode,
  handleStripeWebhookEvent,
} from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { hasPaidAccess } from "@/lib/entitlements";
import { logPaymentFailure } from "@/lib/logger";
import type Stripe from "stripe";

vi.mock("@/lib/prisma", () => {
  const client = {
    subscription: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
    // The claim-then-upsert in syncSubscriptionFromStripe runs in a
    // transaction; the mock hands the callback this same client.
    $transaction: vi.fn(),
  };
  client.$transaction.mockImplementation((fn: (tx: typeof client) => unknown) => fn(client));
  return { prisma: client };
});

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
    subscriptions: { update: vi.fn(), retrieve: vi.fn(), cancel: vi.fn() },
    subscriptionSchedules: { create: vi.fn(), update: vi.fn(), release: vi.fn(), retrieve: vi.fn() },
    promotionCodes: { list: vi.fn() },
  },
  STRIPE_PRICE_IDS: { MONTHLY: "price_monthly", ANNUAL: "price_annual" },
}));

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/entitlements", () => ({ hasPaidAccess: vi.fn(() => Promise.resolve(false)) }));
vi.mock("@/lib/logger", () => ({ logPaymentFailure: vi.fn() }));

const mockedPrisma = prisma as unknown as {
  subscription: Record<string, ReturnType<typeof vi.fn>>;
  user: Record<string, ReturnType<typeof vi.fn>>;
};
const mockedStripe = stripe as unknown as {
  checkout: { sessions: Record<string, ReturnType<typeof vi.fn>> };
  subscriptions: Record<string, ReturnType<typeof vi.fn>>;
  subscriptionSchedules: Record<string, ReturnType<typeof vi.fn>>;
  promotionCodes: Record<string, ReturnType<typeof vi.fn>>;
};

const DAY = 24 * 60 * 60;
const NOW = Math.floor(Date.now() / 1000);
const PERIOD_START = NOW - 10 * DAY;
const PERIOD_END = NOW + 20 * DAY;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  mockedPrisma.subscription.updateMany.mockResolvedValue({ count: 1 });
  mockedPrisma.subscription.upsert.mockResolvedValue({});
});

function fakeStripeSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    cancel_at: null,
    schedule: null,
    metadata: {},
    items: {
      data: [
        {
          id: "si_1",
          price: { id: "price_monthly" },
          current_period_end: PERIOD_END,
          discounts: [],
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function fakeAnnualSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return fakeStripeSubscription({
    items: { data: [{ id: "si_1", price: { id: "price_annual" }, current_period_end: PERIOD_END, discounts: [] }] },
    ...overrides,
  } as Partial<Stripe.Subscription>);
}

function fakePhase(
  price: string,
  start: number,
  end: number,
  overrides: Partial<Stripe.SubscriptionSchedule.Phase> = {},
): Stripe.SubscriptionSchedule.Phase {
  return {
    start_date: start,
    end_date: end,
    items: [{ price, quantity: 1, discounts: [] }],
    discounts: [],
    metadata: {},
    proration_behavior: "create_prorations",
    ...overrides,
  } as unknown as Stripe.SubscriptionSchedule.Phase;
}

// What subscriptionSchedules.create({ from_subscription }) hands back: one
// phase that mirrors the subscription's current period.
function fakeSchedule(overrides: Partial<Stripe.SubscriptionSchedule> = {}): Stripe.SubscriptionSchedule {
  return {
    id: "sub_sched_1",
    status: "active",
    metadata: {},
    current_phase: { start_date: PERIOD_START, end_date: PERIOD_END },
    phases: [fakePhase("price_monthly", PERIOD_START, PERIOD_END)],
    ...overrides,
  } as unknown as Stripe.SubscriptionSchedule;
}

// A switch switchPlan scheduled: this period on Monthly, the next on Annual.
function pendingAnnualSchedule(overrides: Partial<Stripe.SubscriptionSchedule> = {}): Stripe.SubscriptionSchedule {
  return fakeSchedule({
    metadata: { prephub: "plan_switch", userId: "user1" },
    phases: [
      fakePhase("price_monthly", PERIOD_START, PERIOD_END),
      fakePhase("price_annual", PERIOD_END, PERIOD_END + 365 * DAY, { proration_behavior: "none" }),
    ],
    ...overrides,
  });
}

describe("mapStripeStatus", () => {
  it("maps active/trialing without a scheduled cancellation to ACTIVE", () => {
    expect(mapStripeStatus("active", false)).toBe("ACTIVE");
    expect(mapStripeStatus("trialing", false)).toBe("ACTIVE");
  });

  it("maps active/trialing WITH a scheduled cancellation to CANCELED", () => {
    expect(mapStripeStatus("active", true)).toBe("CANCELED");
    expect(mapStripeStatus("trialing", true)).toBe("CANCELED");
  });

  it("maps past_due and unpaid to PAST_DUE", () => {
    expect(mapStripeStatus("past_due", false)).toBe("PAST_DUE");
    expect(mapStripeStatus("unpaid", false)).toBe("PAST_DUE");
  });

  it("maps everything else to EXPIRED", () => {
    expect(mapStripeStatus("canceled", false)).toBe("EXPIRED");
    expect(mapStripeStatus("incomplete", false)).toBe("EXPIRED");
    expect(mapStripeStatus("incomplete_expired", false)).toBe("EXPIRED");
    expect(mapStripeStatus("paused", false)).toBe("EXPIRED");
  });
});

describe("createCheckoutSession", () => {
  it("selects the right price for each plan and passes client_reference_id", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);
    mockedStripe.checkout.sessions.create.mockResolvedValue({ url: "https://checkout.stripe.com/x" });

    const url = await createCheckoutSession("user1", "ANNUAL", "http://localhost:3000");

    expect(url).toBe("https://checkout.stripe.com/x");
    const call = mockedStripe.checkout.sessions.create.mock.calls[0][0];
    expect(call.line_items).toEqual([{ price: "price_annual", quantity: 1 }]);
    expect(call.client_reference_id).toBe("user1");
    expect(call.allow_promotion_codes).toBe(true);
  });

  it("reuses an existing Stripe customer instead of letting Stripe create a new one", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({ stripeCustomerId: "cus_existing" });
    mockedStripe.checkout.sessions.create.mockResolvedValue({ url: "https://checkout.stripe.com/x" });

    await createCheckoutSession("user1", "MONTHLY", "http://localhost:3000");

    const call = mockedStripe.checkout.sessions.create.mock.calls[0][0];
    expect(call.customer).toBe("cus_existing");
  });

  it("puts the account id on the subscription so later events can be attributed", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);
    mockedStripe.checkout.sessions.create.mockResolvedValue({ url: "https://checkout.stripe.com/x" });

    await createCheckoutSession("user1", "MONTHLY", "http://localhost:3000");

    const call = mockedStripe.checkout.sessions.create.mock.calls[0][0];
    expect(call.subscription_data).toEqual({ metadata: { userId: "user1" } });
  });

  it("never passes a complimentary row's made-up customer id to Stripe", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({ stripeCustomerId: "manual_comp_abc" });
    mockedStripe.checkout.sessions.create.mockResolvedValue({ url: "https://checkout.stripe.com/x" });

    await createCheckoutSession("user1", "MONTHLY", "http://localhost:3000");

    expect(mockedStripe.checkout.sessions.create.mock.calls[0][0].customer).toBeUndefined();
  });

  it("refuses a second checkout for a student who already has Premium", async () => {
    (hasPaidAccess as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

    await expect(createCheckoutSession("user1", "MONTHLY", "http://x")).rejects.toMatchObject({
      code: "ALREADY_SUBSCRIBED",
    });
    expect(mockedStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("throws STRIPE_NOT_CONFIGURED when no secret key is set", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await expect(createCheckoutSession("user1", "MONTHLY", "http://x")).rejects.toMatchObject({
      code: "STRIPE_NOT_CONFIGURED",
    });
  });
});

describe("syncSubscriptionFromStripe", () => {
  it("creates a new local row using fallbackUserId when none exists yet (first checkout)", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);

    await syncSubscriptionFromStripe(fakeStripeSubscription(), "user1");

    const call = mockedPrisma.subscription.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId: "user1" });
    expect(call.create.plan).toBe("MONTHLY");
    expect(call.create.status).toBe("ACTIVE");
    expect(call.create.pendingPlan).toBeNull();
  });

  it("throws for a live subscription it can't attribute, so Stripe retries the delivery", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);

    await expect(syncSubscriptionFromStripe(fakeStripeSubscription())).rejects.toThrow();
    expect(mockedPrisma.subscription.upsert).not.toHaveBeenCalled();
  });

  it("lets an ended subscription it can't attribute go quietly", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);

    await syncSubscriptionFromStripe(fakeStripeSubscription({ status: "canceled" }));

    expect(mockedPrisma.subscription.upsert).not.toHaveBeenCalled();
  });

  it("attributes a subscription by the account id checkout put in its metadata", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);

    await syncSubscriptionFromStripe(fakeStripeSubscription({ metadata: { userId: "user1" } }));

    expect(mockedPrisma.subscription.upsert.mock.calls[0][0].where).toEqual({ userId: "user1" });
  });

  it("doesn't let a different, ended subscription overwrite the one the student is on", async () => {
    mockedPrisma.subscription.findUnique
      .mockResolvedValueOnce(null) // no row for this event's customer
      .mockResolvedValueOnce({ userId: "user1", status: "ACTIVE", stripeSubscriptionId: "sub_live" });

    await syncSubscriptionFromStripe(fakeStripeSubscription({ id: "sub_stray", status: "canceled" }), "user1");

    expect(mockedPrisma.subscription.upsert).not.toHaveBeenCalled();
  });

  it("starts a 7-day grace period by claiming the move into past_due", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({ userId: "user1", status: "ACTIVE" });
    mockedPrisma.user.findUnique.mockResolvedValue({ id: "user1", email: "a@b.com" });

    await syncSubscriptionFromStripe(fakeStripeSubscription({ status: "past_due" }));

    const claim = mockedPrisma.subscription.updateMany.mock.calls[0][0];
    expect(claim.where).toEqual({ userId: "user1", status: { not: "PAST_DUE" } });
    expect(claim.data.status).toBe("PAST_DUE");
    expect(claim.data.gracePeriodEndsAt.getTime()).toBeGreaterThan(Date.now() + 6 * DAY * 1000);
    const call = mockedPrisma.subscription.upsert.mock.calls[0][0];
    expect(call.update.status).toBe("PAST_DUE");
    // The upsert leaves the grace period to the claim.
    expect(call.update.gracePeriodEndsAt).toBeUndefined();
  });

  it("does not reset the grace period clock on a repeated past_due sync (duplicate webhook)", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({
      userId: "user1",
      status: "PAST_DUE",
      gracePeriodEndsAt: new Date(Date.now() + 3 * DAY * 1000),
    });
    mockedPrisma.subscription.updateMany.mockResolvedValue({ count: 0 });

    await syncSubscriptionFromStripe(fakeStripeSubscription({ status: "past_due" }));

    const call = mockedPrisma.subscription.upsert.mock.calls[0][0];
    expect(call.update.gracePeriodEndsAt).toBeUndefined();
  });

  it("gives a past-due row with no grace period one", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({ userId: "user1", status: "PAST_DUE", gracePeriodEndsAt: null });
    mockedPrisma.subscription.updateMany.mockResolvedValue({ count: 0 });

    await syncSubscriptionFromStripe(fakeStripeSubscription({ status: "past_due" }));

    expect(mockedPrisma.subscription.upsert.mock.calls[0][0].update.gracePeriodEndsAt).toBeInstanceOf(Date);
  });

  it("clears the grace period once the subscription is active again", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({
      userId: "user1",
      status: "PAST_DUE",
      gracePeriodEndsAt: new Date(),
    });

    await syncSubscriptionFromStripe(fakeStripeSubscription({ status: "active" }));

    const call = mockedPrisma.subscription.upsert.mock.calls[0][0];
    expect(call.update.gracePeriodEndsAt).toBeNull();
    expect(mockedPrisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it("sends a payment-failed email only on the transition into past_due, not on repeats", async () => {
    const { sendEmail } = await import("@/lib/email");

    mockedPrisma.subscription.findUnique.mockResolvedValue({ userId: "user1", status: "ACTIVE" });
    mockedPrisma.user.findUnique.mockResolvedValue({ id: "user1", email: "a@b.com" });

    await syncSubscriptionFromStripe(fakeStripeSubscription({ status: "past_due" }));
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((sendEmail as ReturnType<typeof vi.fn>).mock.calls[0][0].text).toContain("the 800 Club");

    vi.clearAllMocks();
    mockedPrisma.subscription.findUnique.mockResolvedValue({ userId: "user1", status: "PAST_DUE" });
    mockedPrisma.subscription.updateMany.mockResolvedValue({ count: 0 });

    await syncSubscriptionFromStripe(fakeStripeSubscription({ status: "past_due" }));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends one email when two deliveries both read the row before either wrote it", async () => {
    const { sendEmail } = await import("@/lib/email");
    // Both calls see ACTIVE; the database lets only one claim change the row.
    mockedPrisma.subscription.findUnique.mockResolvedValue({ userId: "user1", status: "ACTIVE" });
    mockedPrisma.subscription.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    mockedPrisma.user.findUnique.mockResolvedValue({ id: "user1", email: "a@b.com" });

    await Promise.all([
      syncSubscriptionFromStripe(fakeStripeSubscription({ status: "past_due" })),
      syncSubscriptionFromStripe(fakeStripeSubscription({ status: "past_due" })),
    ]);

    expect(mockedPrisma.subscription.updateMany).toHaveBeenCalledTimes(2);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("records a switch waiting on the subscription's schedule, fetching the schedule when only its id is given", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({ userId: "user1", status: "ACTIVE" });
    mockedStripe.subscriptionSchedules.retrieve.mockResolvedValue(pendingAnnualSchedule());

    await syncSubscriptionFromStripe(fakeStripeSubscription({ schedule: "sub_sched_1" }));

    expect(mockedStripe.subscriptionSchedules.retrieve).toHaveBeenCalledWith("sub_sched_1");
    const call = mockedPrisma.subscription.upsert.mock.calls[0][0];
    expect(call.update.pendingPlan).toBe("ANNUAL");
    expect(call.update.pendingPlanStartsAt).toEqual(new Date(PERIOD_END * 1000));
  });

  it("records no switch for a subscription that's ending", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({ userId: "user1", status: "ACTIVE" });

    await syncSubscriptionFromStripe(fakeStripeSubscription({ cancel_at_period_end: true, schedule: "sub_sched_1" }));

    expect(mockedStripe.subscriptionSchedules.retrieve).not.toHaveBeenCalled();
    expect(mockedPrisma.subscription.upsert.mock.calls[0][0].update.pendingPlan).toBeNull();
  });
});

describe("scheduledPlanChange", () => {
  it("names the plan and date the next phase moves to", () => {
    expect(scheduledPlanChange(pendingAnnualSchedule(), "MONTHLY")).toEqual({
      plan: "ANNUAL",
      startsAt: new Date(PERIOD_END * 1000),
    });
  });

  it("is null when the schedule has nothing after the current phase", () => {
    expect(scheduledPlanChange(fakeSchedule(), "MONTHLY")).toBeNull();
  });

  it("is null when the next phase is the same plan", () => {
    const schedule = fakeSchedule({
      phases: [fakePhase("price_monthly", PERIOD_START, PERIOD_END), fakePhase("price_monthly", PERIOD_END, PERIOD_END + 30 * DAY)],
    });
    expect(scheduledPlanChange(schedule, "MONTHLY")).toBeNull();
  });

  it("is null for a schedule that's been released", () => {
    expect(scheduledPlanChange(pendingAnnualSchedule({ status: "released" }), "MONTHLY")).toBeNull();
  });
});

describe("reconcileCheckoutSession", () => {
  it("throws when the session's client_reference_id doesn't match the current user", async () => {
    mockedStripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: "someone-else",
      payment_status: "paid",
    });

    await expect(reconcileCheckoutSession("cs_1", "user1")).rejects.toMatchObject({
      code: "NO_ACTIVE_SUBSCRIPTION",
    });
  });

  it("reports PROCESSING, and writes nothing, when the payment hasn't cleared yet", async () => {
    mockedStripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: "user1",
      payment_status: "unpaid",
      subscription: fakeStripeSubscription(),
    });
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);

    await expect(reconcileCheckoutSession("cs_1", "user1")).resolves.toBe("PROCESSING");
    expect(mockedPrisma.subscription.upsert).not.toHaveBeenCalled();
  });

  it("syncs and reports ACTIVE when paid with an expanded subscription", async () => {
    mockedStripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: "user1",
      payment_status: "paid",
      subscription: fakeStripeSubscription(),
    });
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);

    await expect(reconcileCheckoutSession("cs_1", "user1")).resolves.toBe("ACTIVE");
    expect(mockedPrisma.subscription.upsert).toHaveBeenCalledTimes(1);
  });

  it("fetches the subscription when the session only names it", async () => {
    mockedStripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: "user1",
      payment_status: "paid",
      subscription: "sub_1",
    });
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription());
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);

    await expect(reconcileCheckoutSession("cs_1", "user1")).resolves.toBe("ACTIVE");
    expect(mockedStripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
  });
});

describe("scheduleSubscriptionNonRenewal", () => {
  it("does nothing when there's no subscription", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);
    await scheduleSubscriptionNonRenewal("user1");
    expect(mockedStripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("does nothing when the subscription isn't ACTIVE", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({
      status: "EXPIRED",
      stripeSubscriptionId: "sub_1",
    });
    await scheduleSubscriptionNonRenewal("user1");
    expect(mockedStripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("sets cancel_at_period_end on Stripe and updates the local row when ACTIVE", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({
      status: "ACTIVE",
      stripeSubscriptionId: "sub_1",
    });
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription());
    mockedStripe.subscriptions.update.mockResolvedValue({});
    mockedPrisma.subscription.update.mockResolvedValue({});

    await scheduleSubscriptionNonRenewal("user1");

    expect(mockedStripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: true,
    });
    expect(mockedPrisma.subscription.update).toHaveBeenCalledWith({
      where: { userId: "user1" },
      data: { status: "CANCELED", cancelAtPeriodEnd: true, pendingPlan: null, pendingPlanStartsAt: null },
    });
  });

  it("lets go of a waiting plan switch first, which would otherwise block the cancellation", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({ status: "ACTIVE", stripeSubscriptionId: "sub_1" });
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription({ schedule: pendingAnnualSchedule() }));
    mockedStripe.subscriptions.update.mockResolvedValue({});

    await scheduleSubscriptionNonRenewal("user1");

    expect(mockedStripe.subscriptionSchedules.release).toHaveBeenCalledWith("sub_sched_1");
    expect(mockedStripe.subscriptionSchedules.release.mock.invocationCallOrder[0]).toBeLessThan(
      mockedStripe.subscriptions.update.mock.invocationCallOrder[0],
    );
  });

  it("still updates the local row even if the Stripe call fails (best-effort)", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({
      status: "ACTIVE",
      stripeSubscriptionId: "sub_1",
    });
    mockedStripe.subscriptions.retrieve.mockRejectedValue(new Error("network error"));
    mockedPrisma.subscription.update.mockResolvedValue({});

    await scheduleSubscriptionNonRenewal("user1");

    expect(mockedPrisma.subscription.update).toHaveBeenCalled();
  });
});

describe("cancelSubscriptionForDeletedAccount", () => {
  it("releases a waiting switch, cancels at once, and ends the local row", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({ status: "ACTIVE", stripeSubscriptionId: "sub_1" });
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription({ schedule: pendingAnnualSchedule() }));
    mockedStripe.subscriptions.cancel.mockResolvedValue({});
    mockedPrisma.subscription.update.mockResolvedValue({});

    await cancelSubscriptionForDeletedAccount("user1");

    expect(mockedStripe.subscriptionSchedules.release).toHaveBeenCalledWith("sub_sched_1");
    expect(mockedStripe.subscriptions.cancel).toHaveBeenCalledWith("sub_1");
    expect(mockedPrisma.subscription.update.mock.calls[0][0].data).toMatchObject({ status: "EXPIRED", pendingPlan: null });
  });
});

describe("cancelSubscription", () => {
  it("throws SUBSCRIPTION_NOT_CANCELABLE when there's no active subscription", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);
    await expect(cancelSubscription("user1")).rejects.toMatchObject({
      code: "SUBSCRIPTION_NOT_CANCELABLE",
    });
  });

  it("schedules cancellation and syncs on success", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({
      status: "ACTIVE",
      stripeSubscriptionId: "sub_1",
    });
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription());
    const updated = fakeStripeSubscription({ cancel_at_period_end: true });
    mockedStripe.subscriptions.update.mockResolvedValue(updated);

    await cancelSubscription("user1");

    expect(mockedStripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: true,
    });
    expect(mockedStripe.subscriptionSchedules.release).not.toHaveBeenCalled();
    expect(mockedPrisma.subscription.upsert).toHaveBeenCalled();
  });

  it("releases a waiting plan switch before cancelling", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({ status: "ACTIVE", stripeSubscriptionId: "sub_1" });
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription({ schedule: "sub_sched_1" }));
    mockedStripe.subscriptionSchedules.retrieve.mockResolvedValue(pendingAnnualSchedule());
    mockedStripe.subscriptions.update.mockResolvedValue(fakeStripeSubscription({ cancel_at_period_end: true }));

    await cancelSubscription("user1");

    expect(mockedStripe.subscriptionSchedules.release).toHaveBeenCalledWith("sub_sched_1");
    expect(mockedStripe.subscriptionSchedules.release.mock.invocationCallOrder[0]).toBeLessThan(
      mockedStripe.subscriptions.update.mock.invocationCallOrder[0],
    );
  });
});

describe("reactivateSubscription", () => {
  it("throws NO_ACTIVE_SUBSCRIPTION when not in CANCELED state", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({ status: "EXPIRED" });
    await expect(reactivateSubscription("user1")).rejects.toMatchObject({
      code: "NO_ACTIVE_SUBSCRIPTION",
    });
  });

  it("undoes the scheduled cancellation when CANCELED", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({
      status: "CANCELED",
      stripeSubscriptionId: "sub_1",
    });
    mockedStripe.subscriptions.update.mockResolvedValue(fakeStripeSubscription());

    await reactivateSubscription("user1");

    expect(mockedStripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: false,
    });
  });
});

describe("switchPlan", () => {
  // The row switchPlan starts from; Stripe is what it decides by.
  function monthlyRow() {
    mockedPrisma.subscription.findUnique.mockResolvedValue({
      userId: "user1",
      status: "ACTIVE",
      stripeSubscriptionId: "sub_1",
      plan: "MONTHLY",
    });
  }

  it("throws NO_ACTIVE_SUBSCRIPTION when there's nothing to switch", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);
    await expect(switchPlan("user1", "ANNUAL")).rejects.toMatchObject({
      code: "NO_ACTIVE_SUBSCRIPTION",
    });
  });

  it("schedules Monthly -> Annual for the renewal date and never changes the live price", async () => {
    monthlyRow();
    mockedStripe.subscriptions.retrieve
      .mockResolvedValueOnce(fakeStripeSubscription())
      .mockResolvedValueOnce(fakeStripeSubscription({ schedule: pendingAnnualSchedule() }));
    mockedStripe.subscriptionSchedules.create.mockResolvedValue(fakeSchedule());
    mockedStripe.subscriptionSchedules.update.mockResolvedValue({});

    const result = await switchPlan("user1", "ANNUAL");

    expect(result).toEqual({ kind: "SCHEDULED", plan: "ANNUAL", startsAt: new Date(PERIOD_END * 1000) });
    // The bug this replaced: an in-place price change re-anchors the cycle and invoices today.
    expect(mockedStripe.subscriptions.update).not.toHaveBeenCalled();
    expect(mockedStripe.subscriptionSchedules.create).toHaveBeenCalledWith({ from_subscription: "sub_1" });

    const [id, params] = mockedStripe.subscriptionSchedules.update.mock.calls[0];
    expect(id).toBe("sub_sched_1");
    expect(params.end_behavior).toBe("release");
    expect(params.proration_behavior).toBe("none");
    expect(params.metadata).toEqual({ prephub: "plan_switch", userId: "user1" });
    expect(params.phases).toHaveLength(2);
    expect(params.phases[0]).toMatchObject({
      start_date: PERIOD_START,
      end_date: PERIOD_END,
      items: [{ price: "price_monthly", quantity: 1 }],
    });
    expect(params.phases[1]).toMatchObject({
      items: [{ price: "price_annual", quantity: 1 }],
      duration: { interval: "year", interval_count: 1 },
      proration_behavior: "none",
    });
    expect(params.phases[1].start_date).toBeUndefined();

    // The row learns about the switch from Stripe's own schedule.
    const lastUpsert = mockedPrisma.subscription.upsert.mock.calls.at(-1)![0];
    expect(lastUpsert.update.pendingPlan).toBe("ANNUAL");
    expect(lastUpsert.update.plan).toBe("MONTHLY");
  });

  it("schedules Annual -> Monthly with a monthly next phase", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({ userId: "user1", status: "ACTIVE", stripeSubscriptionId: "sub_1", plan: "ANNUAL" });
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeAnnualSubscription());
    mockedStripe.subscriptionSchedules.create.mockResolvedValue(
      fakeSchedule({ phases: [fakePhase("price_annual", PERIOD_START, PERIOD_END)] }),
    );
    mockedStripe.subscriptionSchedules.update.mockResolvedValue({});

    await switchPlan("user1", "MONTHLY");

    const params = mockedStripe.subscriptionSchedules.update.mock.calls[0][1];
    expect(params.phases[0].items).toEqual([{ price: "price_annual", quantity: 1 }]);
    expect(params.phases[1]).toMatchObject({
      items: [{ price: "price_monthly", quantity: 1 }],
      duration: { interval: "month", interval_count: 1 },
    });
  });

  it("carries the subscription's discount onto the current and the new phase", async () => {
    monthlyRow();
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription());
    mockedStripe.subscriptionSchedules.create.mockResolvedValue(
      fakeSchedule({
        phases: [
          fakePhase("price_monthly", PERIOD_START, PERIOD_END, {
            discounts: [{ coupon: "SAVE20", discount: "di_1", promotion_code: "promo_1" }],
          } as Partial<Stripe.SubscriptionSchedule.Phase>),
        ],
      }),
    );
    mockedStripe.subscriptionSchedules.update.mockResolvedValue({});

    await switchPlan("user1", "ANNUAL");

    const params = mockedStripe.subscriptionSchedules.update.mock.calls[0][1];
    expect(params.phases[0].discounts).toEqual([{ discount: "di_1" }]);
    expect(params.phases[1].discounts).toEqual([{ discount: "di_1" }]);
  });

  it("refuses a subscription that's set to end rather than quietly turning renewal back on", async () => {
    monthlyRow();
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription({ cancel_at_period_end: true }));

    await expect(switchPlan("user1", "ANNUAL")).rejects.toMatchObject({ code: "SUBSCRIPTION_ENDING" });
    expect(mockedStripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(mockedStripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it("refuses a subscription whose payment has failed", async () => {
    monthlyRow();
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription({ status: "past_due" }));
    mockedPrisma.subscription.updateMany.mockResolvedValue({ count: 0 });

    await expect(switchPlan("user1", "ANNUAL")).rejects.toMatchObject({ code: "NO_ACTIVE_SUBSCRIPTION" });
    expect(mockedStripe.subscriptionSchedules.create).not.toHaveBeenCalled();
  });

  it("throws SAME_PLAN when switching to the current plan with nothing waiting", async () => {
    monthlyRow();
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription());

    await expect(switchPlan("user1", "MONTHLY")).rejects.toMatchObject({ code: "SAME_PLAN" });
  });

  it("says a repeat click is already scheduled, and changes nothing", async () => {
    monthlyRow();
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription({ schedule: pendingAnnualSchedule() }));

    await expect(switchPlan("user1", "ANNUAL")).rejects.toMatchObject({ code: "SWITCH_ALREADY_SCHEDULED" });
    expect(mockedStripe.subscriptionSchedules.update).not.toHaveBeenCalled();
    expect(mockedStripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    // ...but the row is brought up to date with it on the way.
    expect(mockedPrisma.subscription.upsert.mock.calls[0][0].update.pendingPlan).toBe("ANNUAL");
  });

  it("asking for the current plan while a switch waits releases the schedule", async () => {
    monthlyRow();
    mockedStripe.subscriptions.retrieve
      .mockResolvedValueOnce(fakeStripeSubscription({ schedule: pendingAnnualSchedule() }))
      .mockResolvedValueOnce(fakeStripeSubscription());
    mockedStripe.subscriptionSchedules.release.mockResolvedValue({});

    const result = await switchPlan("user1", "MONTHLY");

    expect(result).toEqual({ kind: "KEPT", plan: "MONTHLY" });
    expect(mockedStripe.subscriptionSchedules.release).toHaveBeenCalledWith("sub_sched_1");
    expect(mockedStripe.subscriptionSchedules.update).not.toHaveBeenCalled();
    expect(mockedPrisma.subscription.upsert.mock.calls.at(-1)![0].update.pendingPlan).toBeNull();
  });

  it("rewrites its own schedule once an earlier switch has taken effect, instead of making another", async () => {
    // Switched to Annual last period; the schedule is in its last phase.
    mockedPrisma.subscription.findUnique.mockResolvedValue({ userId: "user1", status: "ACTIVE", stripeSubscriptionId: "sub_1", plan: "ANNUAL" });
    const inLastPhase = fakeSchedule({
      metadata: { prephub: "plan_switch", userId: "user1" },
      current_phase: { start_date: PERIOD_START, end_date: PERIOD_END },
      phases: [
        fakePhase("price_monthly", PERIOD_START - 30 * DAY, PERIOD_START),
        fakePhase("price_annual", PERIOD_START, PERIOD_END),
      ],
    });
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeAnnualSubscription({ schedule: inLastPhase }));
    mockedStripe.subscriptionSchedules.update.mockResolvedValue({});

    await switchPlan("user1", "MONTHLY");

    expect(mockedStripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    const params = mockedStripe.subscriptionSchedules.update.mock.calls[0][1];
    // The past phase isn't sent back.
    expect(params.phases).toHaveLength(2);
    expect(params.phases[0]).toMatchObject({ start_date: PERIOD_START, items: [{ price: "price_annual", quantity: 1 }] });
    expect(params.phases[1].items).toEqual([{ price: "price_monthly", quantity: 1 }]);
  });

  it("adopts an untagged schedule that only mirrors the subscription", async () => {
    monthlyRow();
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription({ schedule: fakeSchedule() }));
    mockedStripe.subscriptionSchedules.update.mockResolvedValue({});

    await switchPlan("user1", "ANNUAL");

    expect(mockedStripe.subscriptionSchedules.create).not.toHaveBeenCalled();
    expect(mockedStripe.subscriptionSchedules.update).toHaveBeenCalledWith("sub_sched_1", expect.anything());
  });

  it("leaves a hand-made schedule with its own future phases alone", async () => {
    monthlyRow();
    const handMade = fakeSchedule({
      phases: [fakePhase("price_monthly", PERIOD_START, PERIOD_END), fakePhase("price_comp", PERIOD_END, PERIOD_END + 90 * DAY)],
    });
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription({ schedule: handMade }));

    await expect(switchPlan("user1", "ANNUAL")).rejects.toMatchObject({ code: "PLAN_CHANGE_UNAVAILABLE" });
    expect(mockedStripe.subscriptionSchedules.update).not.toHaveBeenCalled();
    expect(mockedStripe.subscriptionSchedules.release).not.toHaveBeenCalled();
  });

  it("refuses a subscription with an item-level discount it couldn't carry across", async () => {
    monthlyRow();
    mockedStripe.subscriptions.retrieve.mockResolvedValue(
      fakeStripeSubscription({
        items: { data: [{ id: "si_1", price: { id: "price_monthly" }, current_period_end: PERIOD_END, discounts: ["di_item"] }] },
      } as Partial<Stripe.Subscription>),
    );

    await expect(switchPlan("user1", "ANNUAL")).rejects.toMatchObject({ code: "PLAN_CHANGE_UNAVAILABLE" });
    expect(mockedStripe.subscriptionSchedules.create).not.toHaveBeenCalled();
  });

  it("puts things back and says so when Stripe fails partway", async () => {
    monthlyRow();
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription());
    mockedStripe.subscriptionSchedules.create.mockResolvedValue(fakeSchedule({ id: "sub_sched_new" }));
    mockedStripe.subscriptionSchedules.update.mockRejectedValue(new Error("Stripe is down"));
    mockedStripe.subscriptionSchedules.release.mockResolvedValue({});

    await expect(switchPlan("user1", "ANNUAL")).rejects.toMatchObject({ code: "PLAN_CHANGE_FAILED" });
    expect(mockedStripe.subscriptionSchedules.release).toHaveBeenCalledWith("sub_sched_new");
    expect(logPaymentFailure).toHaveBeenCalled();
  });
});

describe("applyPromoCode", () => {
  it("throws NO_ACTIVE_SUBSCRIPTION when there's no subscription", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);
    await expect(applyPromoCode("user1", "SAVE20")).rejects.toMatchObject({
      code: "NO_ACTIVE_SUBSCRIPTION",
    });
  });

  it("throws INVALID_PROMO_CODE when the code doesn't exist", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({ stripeSubscriptionId: "sub_1" });
    mockedStripe.promotionCodes.list.mockResolvedValue({ data: [] });

    await expect(applyPromoCode("user1", "FAKE")).rejects.toMatchObject({
      code: "INVALID_PROMO_CODE",
    });
  });

  it("applies the discount when the code is valid", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({ stripeSubscriptionId: "sub_1" });
    mockedStripe.promotionCodes.list.mockResolvedValue({ data: [{ id: "promo_1" }] });
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription());
    mockedStripe.subscriptions.update.mockResolvedValue(fakeStripeSubscription());

    await applyPromoCode("user1", "SAVE20");

    expect(mockedStripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      discounts: [{ promotion_code: "promo_1" }],
    });
  });

  it("puts the discount on every phase when a plan switch is waiting, so it survives the switch", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({ userId: "user1", stripeSubscriptionId: "sub_1" });
    mockedStripe.promotionCodes.list.mockResolvedValue({ data: [{ id: "promo_1" }] });
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription({ schedule: pendingAnnualSchedule() }));
    mockedStripe.subscriptionSchedules.update.mockResolvedValue({});

    await applyPromoCode("user1", "SAVE20");

    expect(mockedStripe.subscriptions.update).not.toHaveBeenCalled();
    const params = mockedStripe.subscriptionSchedules.update.mock.calls[0][1];
    expect(params.phases).toHaveLength(2);
    for (const phase of params.phases) expect(phase.discounts).toEqual([{ promotion_code: "promo_1" }]);
    expect(params.phases[1].items).toEqual([{ price: "price_annual", quantity: 1 }]);
  });
});

describe("handleStripeWebhookEvent", () => {
  it("syncs on a paid checkout.session.completed", async () => {
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription());
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);

    await handleStripeWebhookEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "user1",
          payment_status: "paid",
          subscription: "sub_1",
        },
      },
    } as unknown as Stripe.Event);

    expect(mockedStripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
    expect(mockedPrisma.subscription.upsert).toHaveBeenCalled();
  });

  it("ignores an unpaid checkout.session.completed", async () => {
    await handleStripeWebhookEvent({
      type: "checkout.session.completed",
      data: {
        object: { client_reference_id: "user1", payment_status: "unpaid", subscription: "sub_1" },
      },
    } as unknown as Stripe.Event);

    expect(mockedStripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it("syncs on customer.subscription.updated and .deleted from Stripe's current state", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({ userId: "user1", status: "ACTIVE" });
    mockedStripe.subscriptions.retrieve.mockImplementation((id: string) =>
      Promise.resolve(fakeStripeSubscription({ id })),
    );

    await handleStripeWebhookEvent({
      type: "customer.subscription.updated",
      data: { object: fakeStripeSubscription() },
    } as unknown as Stripe.Event);
    expect(mockedPrisma.subscription.upsert).toHaveBeenCalledTimes(1);

    await handleStripeWebhookEvent({
      type: "customer.subscription.deleted",
      data: { object: fakeStripeSubscription({ status: "canceled" }) },
    } as unknown as Stripe.Event);
    expect(mockedPrisma.subscription.upsert).toHaveBeenCalledTimes(2);
    expect(mockedStripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
  });

  it("syncs when a delayed payment method finally succeeds", async () => {
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription());
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);

    await handleStripeWebhookEvent({
      type: "checkout.session.async_payment_succeeded",
      data: { object: { client_reference_id: "user1", payment_status: "paid", subscription: "sub_1" } },
    } as unknown as Stripe.Event);

    expect(mockedPrisma.subscription.upsert).toHaveBeenCalled();
  });

  it("re-syncs a subscription when its schedule is released from the dashboard", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({ userId: "user1", status: "ACTIVE" });
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription());

    await handleStripeWebhookEvent({
      type: "subscription_schedule.released",
      data: { object: { id: "sub_sched_1", subscription: null, released_subscription: "sub_1" } },
    } as unknown as Stripe.Event);

    expect(mockedStripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_1");
    expect(mockedPrisma.subscription.upsert.mock.calls[0][0].update.pendingPlan).toBeNull();
  });

  it("ignores unrelated event types", async () => {
    await handleStripeWebhookEvent({ type: "payment_intent.succeeded", data: { object: {} } } as unknown as Stripe.Event);
    expect(mockedPrisma.subscription.upsert).not.toHaveBeenCalled();
  });
});
