"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  cancelSubscriptionAction,
  reactivateSubscriptionAction,
  switchPlanAction,
  applyPromoCodeAction,
  type ActionState,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { PLAN_NAME, PREMIUM_INCLUDES, planPrice, type DisplayPlan } from "@/lib/billing/display";
import { STALE_BUILD_MESSAGE, isStaleServerActionError } from "@/lib/stale-build";

const initialState: ActionState = {};

const SOMETHING_FAILED = "Something went wrong and nothing was changed. Please try again.";

function failureMessage(err: unknown): string {
  return isStaleServerActionError(err) ? STALE_BUILD_MESSAGE : SOMETHING_FAILED;
}

export function CancelSubscriptionControl({
  accessEndsOn,
  pendingSwitch,
}: {
  accessEndsOn: string;
  /** "Annual on December 1, 2026", when a switch is waiting — cancelling drops it. */
  pendingSwitch: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleConfirm() {
    startTransition(async () => {
      try {
        const result = await cancelSubscriptionAction();
        if (result.error) {
          setError(result.error);
          return;
        }
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(failureMessage(err));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        render={
          <button type="button" onClick={() => setOpen(true)}>
            Cancel Subscription
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel your subscription?</DialogTitle>
          <DialogDescription>
            You keep Premium until {accessEndsOn}. After that, {PREMIUM_INCLUDES} will no longer be available. Nothing
            renews or is charged again, and your learning progress stays saved.
            {pendingSwitch && ` Your switch to ${pendingSwitch} won't happen.`} You can reverse this any time before{" "}
            {accessEndsOn}.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Keep Subscription</Button>} />
          <Button variant="destructive" disabled={isPending} onClick={handleConfirm}>
            {isPending ? "Cancelling..." : "Confirm Cancellation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReactivateControl() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            try {
              const result = await reactivateSubscriptionAction();
              if (result.error) setError(result.error);
              else router.refresh();
            } catch (err) {
              setError(failureMessage(err));
            }
          })
        }
      >
        {isPending ? "Reactivating..." : "Reactivate Subscription"}
      </Button>
    </div>
  );
}

/**
 * Monthly ↔ Annual. The switch waits for the renewal date — Stripe keeps the
 * current price until then (lib/billing's switchPlan) — and the dialog says
 * exactly that, with both prices, before anything is scheduled. With a switch
 * already waiting, the control becomes the way to call it off.
 */
export function SwitchPlanControl({
  currentPlan,
  renewsOn,
  pendingPlan,
  pendingOn,
}: {
  currentPlan: DisplayPlan;
  renewsOn: string;
  pendingPlan: DisplayPlan | null;
  pendingOn: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const targetPlan: DisplayPlan = currentPlan === "ANNUAL" ? "MONTHLY" : "ANNUAL";

  function submit(plan: DisplayPlan) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await switchPlanAction(plan);
        if (result.error) {
          setError(result.error);
          return;
        }
        setOpen(false);
        setMessage(result.message ?? null);
        router.refresh();
      } catch (err) {
        setError(failureMessage(err));
      }
    });
  }

  const feedback = (
    <>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </>
  );

  if (pendingPlan && pendingOn) {
    return (
      <div className="flex flex-col gap-2">
        {feedback}
        <p className="text-sm">
          Switches to <span className="font-medium">{PLAN_NAME[pendingPlan]}</span> ({planPrice(pendingPlan)}) on{" "}
          {pendingOn}. Nothing is charged until then.
        </p>
        <Button variant="outline" disabled={isPending} onClick={() => submit(currentPlan)}>
          {isPending ? "Updating..." : `Keep ${PLAN_NAME[currentPlan]} instead`}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {!open && feedback}
      <Dialog open={open} onOpenChange={setOpen}>
        <Button
          variant="outline"
          render={
            <button type="button" onClick={() => setOpen(true)}>
              Switch to {PLAN_NAME[targetPlan]} · {planPrice(targetPlan)}
            </button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Switch to {PLAN_NAME[targetPlan]} on {renewsOn}?
            </DialogTitle>
            <DialogDescription>
              You stay on {PLAN_NAME[currentPlan]} until {renewsOn}, when it would renew. From then you&apos;ll be charged{" "}
              {planPrice(targetPlan)} instead of {planPrice(currentPlan)}. Nothing is charged today, Premium carries on
              without a break, and you can keep {PLAN_NAME[currentPlan]} any time before {renewsOn}.
            </DialogDescription>
          </DialogHeader>
          {open && feedback}
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Not now</Button>} />
            <Button disabled={isPending} onClick={() => submit(targetPlan)}>
              {isPending ? "Scheduling..." : "Schedule the switch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PromoCodeForm() {
  const [state, formAction, pending] = useActionState(applyPromoCodeAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.success && <p className="text-sm text-muted-foreground">Promo code applied.</p>}
      <Label htmlFor="code">Promo code</Label>
      <div className="flex gap-2">
        <Input id="code" name="code" placeholder="PREPHUB20" />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Applying..." : "Apply"}
        </Button>
      </div>
    </form>
  );
}
