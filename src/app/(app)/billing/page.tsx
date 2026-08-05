import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  CancelSubscriptionControl,
  ReactivateControl,
  SwitchPlanForm,
  PromoCodeForm,
} from "./billing-controls";

const PLAN_LABEL: Record<string, string> = { MONTHLY: "Monthly ($25/mo)", ANNUAL: "Annual ($99/yr)" };

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default async function BillingPage() {
  const session = await auth();
  if (!session?.user.id) redirect("/login");

  const subscription = await prisma.subscription.findUnique({ where: { userId: session.user.id } });

  if (!subscription) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <Card>
          <CardHeader>
            <CardTitle>Billing</CardTitle>
            <CardDescription>You don&apos;t have an individual subscription yet.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/pricing">View Plans</Link>} />
          </CardContent>
        </Card>
      </div>
    );
  }

  const [paymentMethodLabel, invoices] = await Promise.all([
    getDefaultPaymentMethodLabel(subscription.stripeCustomerId),
    stripe.invoices
      .list({ customer: subscription.stripeCustomerId, limit: 10 })
      .then((r) => r.data)
      .catch(() => []),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Billing</h1>

      {subscription.status === "PAST_DUE" && (
        <Alert variant="destructive">
          <AlertDescription>
            Your last payment failed. Update your payment method by{" "}
            {formatDate(subscription.gracePeriodEndsAt)} to keep Personalized Practice access.
          </AlertDescription>
        </Alert>
      )}
      {subscription.status === "CANCELED" && (
        <Alert>
          <AlertDescription>
            Your subscription is set to end on {formatDate(subscription.currentPeriodEnd)}. You
            can reactivate it before then.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Current plan</CardTitle>
            <Badge variant={subscription.status === "ACTIVE" ? "default" : "secondary"}>
              {subscription.status}
            </Badge>
          </div>
          <CardDescription>{subscription.plan ? PLAN_LABEL[subscription.plan] : "—"}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Next renewal</dt>
            <dd>{subscription.cancelAtPeriodEnd ? "Won't renew" : formatDate(subscription.currentPeriodEnd)}</dd>
            <dt className="text-muted-foreground">Payment method</dt>
            <dd>{paymentMethodLabel}</dd>
          </dl>

          <Separator />

          {subscription.status === "ACTIVE" && (
            <div className="flex flex-col gap-3">
              <SwitchPlanForm currentPlan={subscription.plan} />
              <CancelSubscriptionControl accessEndsOn={formatDate(subscription.currentPeriodEnd)} />
            </div>
          )}
          {subscription.status === "CANCELED" && <ReactivateControl />}
          {subscription.status === "EXPIRED" && (
            <Button render={<Link href="/pricing">Subscribe Again</Link>} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Promotional code</CardTitle>
        </CardHeader>
        <CardContent>
          <PromoCodeForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing history</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {invoices.map((invoice) => (
                <li key={invoice.id} className="flex items-center justify-between text-sm">
                  <span>
                    {formatDate(invoice.created ? new Date(invoice.created * 1000) : null)} —{" "}
                    {invoice.total ? `$${(invoice.total / 100).toFixed(2)}` : "—"}
                  </span>
                  {invoice.hosted_invoice_url && (
                    <a
                      href={invoice.hosted_invoice_url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      Receipt
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function getDefaultPaymentMethodLabel(stripeCustomerId: string): Promise<string> {
  try {
    const customer = await stripe.customers.retrieve(stripeCustomerId, {
      expand: ["invoice_settings.default_payment_method"],
    });
    if (customer.deleted) return "—";
    const pm = customer.invoice_settings.default_payment_method;
    if (pm && typeof pm !== "string" && pm.card) {
      return `${pm.card.brand.toUpperCase()} •••• ${pm.card.last4}`;
    }
    return "—";
  } catch {
    return "—";
  }
}
