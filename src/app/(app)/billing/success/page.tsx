import { redirect } from "next/navigation";
import { PartyPopper } from "lucide-react";
import { auth } from "@/auth";
import { reconcileCheckoutSession } from "@/lib/billing";
import { BillingError } from "@/lib/billing/errors";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";

export const metadata = { title: "Checkout" };

// Stripe's success_url target. In production the webhook (src/app/api/stripe/webhook)
// is the source of truth for activating the subscription; this page independently
// reconciles the same checkout session so the student sees "you're subscribed"
// immediately, and — since this sandbox has no public URL for Stripe to call —
// so the purchase actually takes effect at all in local dev/e2e.
export default async function BillingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id: sessionId } = await searchParams;
  const session = await auth();
  if (!session?.user.id) redirect("/login");
  if (!sessionId) redirect("/pricing");

  let outcome: Awaited<ReturnType<typeof reconcileCheckoutSession>>;
  try {
    outcome = await reconcileCheckoutSession(sessionId, session.user.id);
  } catch (err) {
    if (err instanceof BillingError) {
      return (
        <div className="mx-auto max-w-md p-8">
          <Card>
            <CardHeader>
              <CardTitle>Something went wrong</CardTitle>
              <CardDescription>{err.message}</CardDescription>
            </CardHeader>
            <CardContent>
              <LinkButton href="/pricing">Back to Pricing</LinkButton>
            </CardContent>
          </Card>
        </div>
      );
    }
    throw err;
  }

  // A bank debit completes checkout before the money arrives. Saying "active"
  // then was untrue — Premium only switches on when Stripe reports the
  // payment (checkout.session.async_payment_succeeded, through the webhook).
  if (outcome === "PROCESSING") {
    return (
      <div className="mx-auto max-w-md p-8">
        <Card>
          <CardHeader>
            <CardTitle>Payment processing</CardTitle>
            <CardDescription>
              Premium switches on as soon as your payment clears. Some payment methods take a few days; there&apos;s
              nothing more you need to do, and no need to check out again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LinkButton href="/home">Go to Dashboard</LinkButton>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md p-8">
      <Card>
        <CardHeader>
          <PartyPopper className="mb-2 size-6 text-primary" aria-hidden />
          <CardTitle>You&apos;re subscribed</CardTitle>
          <CardDescription>Your PrepHub subscription is active.</CardDescription>
        </CardHeader>
        <CardContent>
          <LinkButton href="/home">Go to Dashboard</LinkButton>
        </CardContent>
      </Card>
    </div>
  );
}
