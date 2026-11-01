export class BillingError extends Error {
  constructor(
    public code:
      | "NO_ACTIVE_SUBSCRIPTION"
      | "SUBSCRIPTION_NOT_CANCELABLE"
      | "SAME_PLAN"
      | "INVALID_PROMO_CODE"
      | "STRIPE_NOT_CONFIGURED"
      | "ALREADY_SUBSCRIBED"
      | "SUBSCRIPTION_ENDING"
      | "SWITCH_ALREADY_SCHEDULED"
      | "PLAN_CHANGE_UNAVAILABLE"
      | "PLAN_CHANGE_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}
