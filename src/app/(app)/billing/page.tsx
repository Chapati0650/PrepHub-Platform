import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { stripe } from "@/lib/stripe";
import { getAccessContext, getAccessSummary } from "@/lib/entitlements";
import { formatLongLocalDate } from "@/lib/community/local-day";
import { PLAN_NAME, PREMIUM_INCLUDES, planLabel, subscriptionStatusLabel } from "@/lib/billing/display";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import {
  CancelSubscriptionControl,
  ReactivateControl,
  SwitchPlanControl,
  PromoCodeForm,
} from "./billing-controls";

export const metadata = { title: "Billing" };

// Renewal dates are instants; shown as the calendar day where PrepHub's
// students are, the same zone every other date in the app uses.
function formatDate(date: Date | null): string {
  return date ? formatLongLocalDate(date) : "—";
}

export default async function BillingPage() {
  const session = await auth();
  if (!session?.user.id) redirect("/login");
  const userId = session.user.id;

  // Role and school coverage come from the entitlement service (cached for
  // the request — the app layout has already read them), so this page can't
  // describe someone's access differently from how it's actually decided. The
  // subscription row is read fresh: this page is what a plan change re-renders.
  const [{ user }, access, subscription] = await Promise.all([
    getAccessContext(userId),
    getAccessSummary(userId),
    prisma.subscription.findUnique({ where: { userId } }),
  ]);
  const role = user?.role ?? null;
  const schoolName = access.type === "SCHOOL" ? access.organizationName : null;

  if (!subscription) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <PageHeader title="Billing" className="mb-6" />
        <Card>
          {schoolName ? (
            // "No subscription yet → View Plans" sent a student their school
            // already covers to /pricing, which then refused to sell them
            // anything: a loop with no way out.
            <>
              <CardHeader>
                <CardTitle>Your school covers Premium</CardTitle>
                <CardDescription>
                  {schoolName} provides PrepHub Premium for you, so there&apos;s nothing to pay and nothing to set up here.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LinkButton href="/home">Go to your dashboard</LinkButton>
              </CardContent>
            </>
          ) : role === "SCHOOL_ADMINISTRATOR" ? (
            <>
              <CardHeader>
                <CardTitle>Premium is included</CardTitle>
                <CardDescription>
                  Your administrator account comes with the full student experience, so there&apos;s nothing to pay.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LinkButton href="/admin">Back to your school</LinkButton>
              </CardContent>
            </>
          ) : role !== "STUDENT" ? (
            <CardHeader>
              <CardTitle>Nothing to pay</CardTitle>
              <CardDescription>Subscriptions are for student accounts. This account doesn&apos;t need one.</CardDescription>
            </CardHeader>
          ) : (
            <>
              <CardHeader>
                <CardTitle>No subscription yet</CardTitle>
                <CardDescription>You don&apos;t have an individual subscription yet.</CardDescription>
              </CardHeader>
              <CardContent>
                <LinkButton href="/pricing">View Plans</LinkButton>
              </CardContent>
            </>
          )}
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

  const renewsOn = formatDate(subscription.currentPeriodEnd);
  const pending =
    subscription.status === "ACTIVE" && subscription.pendingPlan && subscription.pendingPlanStartsAt
      ? { plan: subscription.pendingPlan, on: formatDate(subscription.pendingPlanStartsAt) }
      : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <PageHeader title="Billing" />

      {schoolName && (
        // Selling someone what their school pays for is the mistake the
        // district bar exists to prevent; the same goes for renewing it.
        <Alert>
          <AlertDescription>
            {schoolName} covers Premium for you, so you don&apos;t need this subscription
            {subscription.status === "ACTIVE" ? " — you can cancel it below and keep Premium." : "."}
          </AlertDescription>
        </Alert>
      )}
      {subscription.status === "PAST_DUE" && (
        <Alert variant="destructive">
          <AlertDescription>
            Your last payment failed. Update your payment method by {formatDate(subscription.gracePeriodEndsAt)} to keep
            Premium: {PREMIUM_INCLUDES}.
          </AlertDescription>
        </Alert>
      )}
      {subscription.status === "CANCELED" && (
        <Alert>
          <AlertDescription>
            Your subscription is set to end on {renewsOn}.{schoolName ? "" : " You can reactivate it before then."}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Current plan</CardTitle>
            <Badge variant={subscription.status === "ACTIVE" && !subscription.cancelAtPeriodEnd ? "default" : "secondary"}>
              {subscriptionStatusLabel(subscription.status, subscription.cancelAtPeriodEnd)}
            </Badge>
          </div>
          <CardDescription>{subscription.plan ? planLabel(subscription.plan) : "—"}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Next renewal</dt>
            <dd>{subscription.cancelAtPeriodEnd ? "Won't renew" : renewsOn}</dd>
            {pending && (
              <>
                <dt className="text-muted-foreground">Plan change</dt>
                <dd>
                  Switches to {PLAN_NAME[pending.plan]} on {pending.on}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Payment method</dt>
            <dd>{paymentMethodLabel}</dd>
          </dl>

          <Separator />

          {subscription.status === "ACTIVE" && (
            <div className="flex flex-col gap-3">
              {subscription.plan && !schoolName && (
                <SwitchPlanControl
                  currentPlan={subscription.plan}
                  renewsOn={renewsOn}
                  pendingPlan={pending?.plan ?? null}
                  pendingOn={pending?.on ?? null}
                />
              )}
              <CancelSubscriptionControl
                accessEndsOn={renewsOn}
                pendingSwitch={pending ? `${PLAN_NAME[pending.plan]} on ${pending.on}` : null}
              />
            </div>
          )}
          {subscription.status === "CANCELED" && !schoolName && <ReactivateControl />}
          {subscription.status === "EXPIRED" && !schoolName && role === "STUDENT" && (
            <LinkButton href="/pricing">Subscribe Again</LinkButton>
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
            <EmptyState icon={Receipt} title="No invoices yet" description="Your billing history will show up here after your first payment." />
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
