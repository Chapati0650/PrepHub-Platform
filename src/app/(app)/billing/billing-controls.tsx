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

const initialState: ActionState = {};

export function CancelSubscriptionControl({ accessEndsOn }: { accessEndsOn: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleConfirm() {
    startTransition(async () => {
      const result = await cancelSubscriptionAction();
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
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
            Your subscription will remain active until {accessEndsOn}. After this date,
            Personalized Practice will no longer be available. No future automatic renewals will
            occur, and your learning progress will remain saved. You can reverse this before your
            access ends.
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
            const result = await reactivateSubscriptionAction();
            if (result.error) setError(result.error);
            else router.refresh();
          })
        }
      >
        {isPending ? "Reactivating..." : "Reactivate Subscription"}
      </Button>
    </div>
  );
}

export function SwitchPlanForm({ currentPlan }: { currentPlan: "MONTHLY" | "ANNUAL" | null }) {
  const [state, formAction, pending] = useActionState(switchPlanAction, initialState);
  const targetPlan = currentPlan === "ANNUAL" ? "MONTHLY" : "ANNUAL";
  const targetLabel = targetPlan === "ANNUAL" ? "Annual ($99/yr)" : "Monthly ($25/mo)";

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.success && (
        <p className="text-sm text-muted-foreground">
          Your plan will change at your next renewal date. You won&apos;t be charged anything today.
        </p>
      )}
      <input type="hidden" name="plan" value={targetPlan} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Switching..." : `Switch to ${targetLabel}`}
      </Button>
    </form>
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
