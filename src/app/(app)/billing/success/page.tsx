import Link from "next/link";
import { redirect } from "next/navigation";
import { PartyPopper } from "lucide-react";
import { auth } from "@/auth";
import { reconcileCheckoutSession } from "@/lib/billing";
import { BillingError } from "@/lib/billing/errors";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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

  try {
    await reconcileCheckoutSession(sessionId, session.user.id);
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
              <Button render={<Link href="/pricing">Back to Pricing</Link>} />
            </CardContent>
          </Card>
        </div>
      );
    }
    throw err;
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
          <Button render={<Link href="/home">Go to Dashboard</Link>} />
        </CardContent>
      </Card>
    </div>
  );
}
