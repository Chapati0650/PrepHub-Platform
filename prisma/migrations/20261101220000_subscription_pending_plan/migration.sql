-- A plan switch scheduled for the next renewal (Monthly <-> Annual), mirrored from the Stripe Subscription
-- Schedule that carries it, so Billing can say "Switches to Annual on <date>". Additive and nullable: every
-- existing row means "no switch pending", which is true, since none could be scheduled before this.
ALTER TABLE "subscriptions" ADD COLUMN "pendingPlan" "SubscriptionPlan",
ADD COLUMN "pendingPlanStartsAt" TIMESTAMP(3);
