"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { subscribeAction, type ActionState } from "./actions";
import type { Plan } from "@/lib/billing";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Marker } from "@/components/ui/marker";
import { cn } from "@/lib/utils";
import { PageViewBeacon } from "@/components/analytics/page-view-beacon";

const initialState: ActionState = {};

// Everything listed here sits behind hasPaidAccess (the /practice and
// /practice/session gates) and nothing else does — the Diagnostic, its
// results, the dashboard and Progress are all free, so they are deliberately
// *not* dressed up as Premium features. A Free column of all-crosses is
// honest here: these are precisely the things a free account cannot do.
const PREMIUM_FEATURES = [
  "Unlimited Personalized Practice Sets",
  "Every set rebuilt around your weakest categories",
  "Predicted SAT Score updated after every set",
  "The 800 Club — the hardest questions in the bank",
  "1v1 Rush — live head-to-head, start your own",
  "College Apps — your list, deadlines and score fit",
  "The Curriculum — video lessons as they're published",
] as const;

// Display copy only. The amounts Stripe actually charges live on the Price
// IDs in STRIPE_PRICE_IDS — $25/mo and $99/yr — and this page never sends a
// number to checkout, only the plan name. The Monthly strikethrough is the
// Owner's launch-pricing decision (regular $50, currently $25); Annual has no
// invented "was" price because there isn't a real one to show.
const PLANS: Record<
  Plan,
  { name: string; was: string | null; price: string; period: string; badge: string; note: string; cta: string }
> = {
  MONTHLY: {
    name: "Monthly",
    was: "$50",
    price: "$25",
    period: "/month",
    badge: "50% off",
    note: "Launch price. Billed monthly, cancel anytime.",
    // e2e/billing.spec.ts and e2e/diagnostic-practice.spec.ts click the
    // button named "Subscribe Monthly" — Playwright's role-name match is a
    // substring, so the suffix is fine, but the prefix is a contract.
    cta: "Subscribe Monthly — 50% off",
  },
  ANNUAL: {
    name: "Annual",
    was: null,
    price: "$99",
    period: "/year",
    badge: "Best value",
    note: "$8.25 a month, billed once a year.",
    cta: "Subscribe Annual — $99/year",
  },
};

const PLAN_ORDER: Plan[] = ["MONTHLY", "ANNUAL"];

export default function PricingPage() {
  const [state, formAction, pending] = useActionState(subscribeAction, initialState);
  const [plan, setPlan] = useState<Plan>("MONTHLY");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10 p-6 pb-16 sm:p-10">
      <PageViewBeacon name="paywall_viewed" />
      <div>
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">PrepHub Premium</p>
        <h1 className="mt-3 text-display-sm text-balance">
          Unlock every <Marker>Practice Set</Marker>.
        </h1>
        <p className="mt-4 max-w-prose text-lg text-muted-foreground">
          The Diagnostic and your first Practice Set are free. Every set after that is Premium.
        </p>
      </div>

      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {/* A real table, because it is one: two columns of the same facts. The
          Premium column is a single dark block spanning header and rows —
          border-separate is what makes its rounded corners render, since
          border-collapse discards cell radii. */}
      <table className="w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th scope="col" className="sr-only">
              Feature
            </th>
            <th scope="col" className="w-16 pb-3 text-center text-sm font-medium text-muted-foreground">
              Free
            </th>
            <th
              scope="col"
              className="w-24 rounded-t-2xl bg-surface-deep px-2 pt-4 pb-3 text-center text-sm font-semibold text-marker"
            >
              Premium
            </th>
          </tr>
        </thead>
        <tbody>
          {PREMIUM_FEATURES.map((feature, i) => {
            const last = i === PREMIUM_FEATURES.length - 1;
            return (
              <tr key={feature}>
                <th scope="row" className="border-t border-border py-3.5 pr-4 text-left text-sm font-normal">
                  {feature}
                </th>
                <td className="border-t border-border py-3.5 text-center">
                  <Mark included={false} />
                </td>
                <td className={cn("bg-surface-deep py-3.5 text-center", last && "rounded-b-2xl pb-5")}>
                  <Mark included />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <form action={formAction} className="flex flex-col gap-6">
        {/* Native radios, visually hidden, so the card gets keyboard
            navigation (arrow keys move between plans) and form submission
            for free — the action reads `plan` straight from the checked
            input. The React state only exists so the CTA can name the plan
            it's about to buy. */}
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">Choose a plan</legend>
          {PLAN_ORDER.map((id) => {
            const p = PLANS[id];
            const selected = plan === id;
            return (
              <label
                key={id}
                className={cn(
                  "relative flex cursor-pointer items-start gap-4 rounded-2xl border-2 p-5 pt-6 transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                  selected ? "border-primary bg-surface-tint" : "border-border hover:border-foreground/30",
                )}
              >
                <input
                  type="radio"
                  name="plan"
                  value={id}
                  checked={selected}
                  onChange={() => setPlan(id)}
                  className="sr-only"
                />
                <span
                  aria-hidden
                  className={cn(
                    "mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                    selected ? "border-primary" : "border-foreground/30",
                  )}
                >
                  {selected && <span className="size-2.5 rounded-full bg-primary" />}
                </span>

                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-lg font-semibold">{p.name}</span>
                    <span className="flex items-baseline gap-2 tabular-nums">
                      {p.was && (
                        <>
                          <span className="sr-only">Regular price</span>
                          <s className="text-lg text-muted-foreground">{p.was}</s>
                          <span className="sr-only">now</span>
                        </>
                      )}
                      <span className="font-heading text-3xl font-semibold tracking-tight">{p.price}</span>
                      <span className="text-sm text-muted-foreground">{p.period}</span>
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground">{p.note}</span>
                </span>

                <span className="absolute -top-3 right-5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                  {p.badge}
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="flex flex-col items-center gap-4">
          <Button type="submit" size="cta" className="w-full" disabled={pending}>
            {pending ? "Starting checkout…" : PLANS[plan].cta}
          </Button>
          <Link href="/home" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Not now
          </Link>
        </div>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Renews automatically. Cancel anytime from Billing. Have a promo code? Enter it at checkout.
      </p>
    </div>
  );
}

// Shape *and* color differ between the two states, and each carries visible-
// to-screen-reader text — color is never the only signal (CLAUDE.md, WCAG).
function Mark({ included }: { included: boolean }) {
  return included ? (
    <span className="inline-flex size-6 items-center justify-center rounded-full bg-marker text-surface-deep">
      <Check className="size-3.5" strokeWidth={3} aria-hidden />
      <span className="sr-only">Included</span>
    </span>
  ) : (
    <span className="inline-flex size-6 items-center justify-center rounded-full bg-foreground/10 text-muted-foreground">
      <X className="size-3" strokeWidth={2.5} aria-hidden />
      <span className="sr-only">Not included</span>
    </span>
  );
}
