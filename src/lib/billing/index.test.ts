import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  mapStripeStatus,
  createCheckoutSession,
  syncSubscriptionFromStripe,
  reconcileCheckoutSession,
  scheduleSubscriptionNonRenewal,
  cancelSubscription,
  reactivateSubscription,
  switchPlan,
  applyPromoCode,
  handleStripeWebhookEvent,
} from "@/lib/billing";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    subscription: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: { sessions: { create: vi.fn(), retrieve: vi.fn() } },
    subscriptions: { update: vi.fn(), retrieve: vi.fn() },
    promotionCodes: { list: vi.fn() },
  },
  STRIPE_PRICE_IDS: { MONTHLY: "price_monthly", ANNUAL: "price_annual" },
}));

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(() => Promise.resolve()) }));

const mockedPrisma = prisma as unknown as {
  subscription: Record<string, ReturnType<typeof vi.fn>>;
  user: Record<string, ReturnType<typeof vi.fn>>;
};
const mockedStripe = stripe as unknown as {
  checkout: { sessions: Record<string, ReturnType<typeof vi.fn>> };
  subscriptions: Record<string, ReturnType<typeof vi.fn>>;
  promotionCodes: Record<string, ReturnType<typeof vi.fn>>;
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
});

function fakeStripeSubscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    items: {
      data: [
        {
          id: "si_1",
          price: { id: "price_monthly" },
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
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
    mockedPrisma.subscription.upsert.mockResolvedValue({});

    await syncSubscriptionFromStripe(fakeStripeSubscription(), "user1");

    const call = mockedPrisma.subscription.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId: "user1" });
    expect(call.create.plan).toBe("MONTHLY");
    expect(call.create.status).toBe("ACTIVE");
  });

  it("does nothing when there's no existing row and no fallbackUserId", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);

    await syncSubscriptionFromStripe(fakeStripeSubscription());

    expect(mockedPrisma.subscription.upsert).not.toHaveBeenCalled();
  });

  it("starts a 7-day grace period the first time status becomes past_due", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({ userId: "user1", status: "ACTIVE" });
    mockedPrisma.subscription.upsert.mockResolvedValue({});
    mockedPrisma.user.findUnique.mockResolvedValue({ id: "user1", email: "a@b.com" });

    await syncSubscriptionFromStripe(fakeStripeSubscription({ status: "past_due" }));

    const call = mockedPrisma.subscription.upsert.mock.calls[0][0];
    expect(call.update.status).toBe("PAST_DUE");
    expect(call.update.gracePeriodEndsAt).toBeInstanceOf(Date);
    expect(call.update.gracePeriodEndsAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
  });

  it("does not reset the grace period clock on a repeated past_due sync (duplicate webhook)", async () => {
    const existingGraceEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    mockedPrisma.subscription.findUnique.mockResolvedValue({
      userId: "user1",
      status: "PAST_DUE",
      gracePeriodEndsAt: existingGraceEnd,
    });
    mockedPrisma.subscription.upsert.mockResolvedValue({});

    await syncSubscriptionFromStripe(fakeStripeSubscription({ status: "past_due" }));

    const call = mockedPrisma.subscription.upsert.mock.calls[0][0];
    expect(call.update.gracePeriodEndsAt).toBe(existingGraceEnd);
  });

  it("clears the grace period once the subscription is active again", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({
      userId: "user1",
      status: "PAST_DUE",
      gracePeriodEndsAt: new Date(),
    });
    mockedPrisma.subscription.upsert.mockResolvedValue({});

    await syncSubscriptionFromStripe(fakeStripeSubscription({ status: "active" }));

    const call = mockedPrisma.subscription.upsert.mock.calls[0][0];
    expect(call.update.gracePeriodEndsAt).toBeNull();
  });

  it("sends a payment-failed email only on the transition into past_due, not on repeats", async () => {
    const { sendEmail } = await import("@/lib/email");

    mockedPrisma.subscription.findUnique.mockResolvedValue({ userId: "user1", status: "ACTIVE" });
    mockedPrisma.subscription.upsert.mockResolvedValue({});
    mockedPrisma.user.findUnique.mockResolvedValue({ id: "user1", email: "a@b.com" });

    await syncSubscriptionFromStripe(fakeStripeSubscription({ status: "past_due" }));
    expect(sendEmail).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mockedPrisma.subscription.findUnique.mockResolvedValue({ userId: "user1", status: "PAST_DUE" });
    mockedPrisma.subscription.upsert.mockResolvedValue({});

    await syncSubscriptionFromStripe(fakeStripeSubscription({ status: "past_due" }));
    expect(sendEmail).not.toHaveBeenCalled();
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

  it("no-ops when the session hasn't been paid yet", async () => {
    mockedStripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: "user1",
      payment_status: "unpaid",
      subscription: fakeStripeSubscription(),
    });
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);

    await reconcileCheckoutSession("cs_1", "user1");
    expect(mockedPrisma.subscription.upsert).not.toHaveBeenCalled();
  });

  it("syncs when paid with an expanded subscription", async () => {
    mockedStripe.checkout.sessions.retrieve.mockResolvedValue({
      client_reference_id: "user1",
      payment_status: "paid",
      subscription: fakeStripeSubscription(),
    });
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);
    mockedPrisma.subscription.upsert.mockResolvedValue({});

    await reconcileCheckoutSession("cs_1", "user1");
    expect(mockedPrisma.subscription.upsert).toHaveBeenCalledTimes(1);
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
    mockedStripe.subscriptions.update.mockResolvedValue({});
    mockedPrisma.subscription.update.mockResolvedValue({});

    await scheduleSubscriptionNonRenewal("user1");

    expect(mockedStripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: true,
    });
    expect(mockedPrisma.subscription.update).toHaveBeenCalledWith({
      where: { userId: "user1" },
      data: { status: "CANCELED", cancelAtPeriodEnd: true },
    });
  });

  it("still updates the local row even if the Stripe call fails (best-effort)", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({
      status: "ACTIVE",
      stripeSubscriptionId: "sub_1",
    });
    mockedStripe.subscriptions.update.mockRejectedValue(new Error("network error"));
    mockedPrisma.subscription.update.mockResolvedValue({});

    await scheduleSubscriptionNonRenewal("user1");

    expect(mockedPrisma.subscription.update).toHaveBeenCalled();
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
    const updated = fakeStripeSubscription({ cancel_at_period_end: true });
    mockedStripe.subscriptions.update.mockResolvedValue(updated);
    mockedPrisma.subscription.upsert.mockResolvedValue({});

    await cancelSubscription("user1");

    expect(mockedStripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: true,
    });
    expect(mockedPrisma.subscription.upsert).toHaveBeenCalled();
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
    mockedPrisma.subscription.upsert.mockResolvedValue({});

    await reactivateSubscription("user1");

    expect(mockedStripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: false,
    });
  });
});

describe("switchPlan", () => {
  it("throws NO_ACTIVE_SUBSCRIPTION when there's nothing to switch", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);
    await expect(switchPlan("user1", "ANNUAL")).rejects.toMatchObject({
      code: "NO_ACTIVE_SUBSCRIPTION",
    });
  });

  it("throws SAME_PLAN when switching to the current plan", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({
      status: "ACTIVE",
      stripeSubscriptionId: "sub_1",
      plan: "ANNUAL",
    });
    await expect(switchPlan("user1", "ANNUAL")).rejects.toMatchObject({ code: "SAME_PLAN" });
  });

  it("updates the subscription item price with no proration", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({
      status: "ACTIVE",
      stripeSubscriptionId: "sub_1",
      plan: "MONTHLY",
    });
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription());
    mockedStripe.subscriptions.update.mockResolvedValue(fakeStripeSubscription());
    mockedPrisma.subscription.upsert.mockResolvedValue({});

    await switchPlan("user1", "ANNUAL");

    expect(mockedStripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      items: [{ id: "si_1", price: "price_annual" }],
      proration_behavior: "none",
    });
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
    mockedStripe.subscriptions.update.mockResolvedValue(fakeStripeSubscription());
    mockedPrisma.subscription.upsert.mockResolvedValue({});

    await applyPromoCode("user1", "SAVE20");

    expect(mockedStripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      discounts: [{ promotion_code: "promo_1" }],
    });
  });
});

describe("handleStripeWebhookEvent", () => {
  it("syncs on a paid checkout.session.completed", async () => {
    mockedStripe.subscriptions.retrieve.mockResolvedValue(fakeStripeSubscription());
    mockedPrisma.subscription.findUnique.mockResolvedValue(null);
    mockedPrisma.subscription.upsert.mockResolvedValue({});

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

  it("syncs on customer.subscription.updated and .deleted", async () => {
    mockedPrisma.subscription.findUnique.mockResolvedValue({ userId: "user1", status: "ACTIVE" });
    mockedPrisma.subscription.upsert.mockResolvedValue({});

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
  });

  it("ignores unrelated event types", async () => {
    await handleStripeWebhookEvent({ type: "payment_intent.succeeded", data: { object: {} } } as unknown as Stripe.Event);
    expect(mockedPrisma.subscription.upsert).not.toHaveBeenCalled();
  });
});
