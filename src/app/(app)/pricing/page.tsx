"use client";

import { useActionState } from "react";
import { CreditCard } from "lucide-react";
import { subscribeAction, type ActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PageHeader } from "@/components/page-header";

const initialState: ActionState = {};

export default function PricingPage() {
  const [state, formAction, pending] = useActionState(subscribeAction, initialState);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-8">
      <PageHeader
        icon={CreditCard}
        title="Choose your plan"
        description="Subscriptions renew automatically and can be cancelled anytime from Billing."
      />

      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Monthly</CardTitle>
            <CardDescription>Best suited for students preparing over a shorter period.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="font-heading text-4xl font-semibold tabular-nums">
              $25<span className="text-base font-normal text-muted-foreground">/month</span>
            </p>
            <form action={formAction}>
              <input type="hidden" name="plan" value="MONTHLY" />
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? "Starting checkout..." : "Subscribe Monthly"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-primary">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Annual</CardTitle>
              <Badge>Best Value</Badge>
            </div>
            <CardDescription>Save compared to paying monthly.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="font-heading text-4xl font-semibold tabular-nums">
              $99<span className="text-base font-normal text-muted-foreground">/year</span>
            </p>
            <form action={formAction}>
              <input type="hidden" name="plan" value="ANNUAL" />
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? "Starting checkout..." : "Subscribe Annual"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Have a promo code? You can enter it on the checkout page.
      </p>
    </div>
  );
}
