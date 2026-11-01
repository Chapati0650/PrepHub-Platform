"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { subscribeAction, type ActionState } from "./actions";
import type { Plan } from "@/lib/billing";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import {
  ANNUAL_PERIOD,
  ANNUAL_PRICE,
  MONTHLY_PERIOD,
  MONTHLY_PRICE,
  MONTHLY_REGULAR_PRICE,
  PLAN_NAME,
} from "@/lib/billing/display";

const initialState: ActionState = {};

// Display copy only. The amounts Stripe actually charges live on the Price
// IDs in STRIPE_PRICE_IDS, and this form never sends a number to checkout,
// only the plan name. The Monthly strikethrough is the Owner's launch-pricing
// decision; Annual has no invented "was" price because there isn't a real
// one to show.
const PLANS: Record<
  Plan,
  { name: string; was: string | null; price: string; period: string; badge: string; note: string; cta: string }
> = {
  MONTHLY: {
    name: PLAN_NAME.MONTHLY,
    was: MONTHLY_REGULAR_PRICE,
    price: MONTHLY_PRICE,
    period: MONTHLY_PERIOD,
    badge: "50% off",
    note: "Launch price. Billed monthly, cancel anytime.",
    // e2e/billing.spec.ts and e2e/diagnostic-practice.spec.ts click the
    // button named "Subscribe Monthly" — Playwright's role-name match is a
    // substring, so the suffix is fine, but the prefix is a contract.
    cta: "Subscribe Monthly — 50% off",
  },
  ANNUAL: {
    name: PLAN_NAME.ANNUAL,
    was: null,
    price: ANNUAL_PRICE,
    period: ANNUAL_PERIOD,
    badge: "Best value",
    note: "$8.25 a month, billed once a year.",
    cta: `Subscribe Annual — ${ANNUAL_PRICE}${ANNUAL_PERIOD}`,
  },
};

const PLAN_ORDER: Plan[] = ["MONTHLY", "ANNUAL"];

// The interactive half of /pricing: the two plan cards and the checkout
// button. The page around it is a server component, because what it should
// say depends on who is looking (lib/entitlements decides that, not this).
export function PlanPicker() {
  const [state, formAction, pending] = useActionState(subscribeAction, initialState);
  const [plan, setPlan] = useState<Plan>("MONTHLY");

  return (
    <>
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

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
    </>
  );
}
