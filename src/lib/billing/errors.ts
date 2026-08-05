export class BillingError extends Error {
  constructor(
    public code:
      | "NO_ACTIVE_SUBSCRIPTION"
      | "SUBSCRIPTION_NOT_CANCELABLE"
      | "SAME_PLAN"
      | "INVALID_PROMO_CODE"
      | "STRIPE_NOT_CONFIGURED",
    message: string,
  ) {
    super(message);
    this.name = "BillingError";
  }
}
