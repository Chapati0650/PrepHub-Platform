import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { handleStripeWebhookEvent } from "@/lib/billing";
import { logPaymentFailure } from "@/lib/logger";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Missing signature or webhook secret" }, { status: 400 });
  }

  // Signature verification needs the exact raw bytes Stripe signed — not a
  // parsed-and-re-serialized body, which would produce a different signature.
  const rawBody = await req.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    logPaymentFailure("Stripe webhook signature verification failed", { errorType: message });
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    await handleStripeWebhookEvent(event);
  } catch (err) {
    // Non-2xx makes Stripe retry the delivery — syncSubscriptionFromStripe's
    // upsert design makes retries safe (see src/lib/billing/index.ts).
    logPaymentFailure("Stripe webhook handler failed", {
      affectedResourceId: event.id,
      eventType: event.type,
      errorType: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
