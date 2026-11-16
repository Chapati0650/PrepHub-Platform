"use client";

import { useActionState } from "react";
import Link from "next/link";
import { joinRushAsGuestAction, type GuestJoinState } from "../actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function GuestJoinForm({ code }: { code: string }) {
  const [state, action, pending] = useActionState<GuestJoinState, FormData>(joinRushAsGuestAction, {});
  return (
    <form action={action} className="mt-8 flex max-w-sm flex-col gap-5">
      <input type="hidden" name="code" value={code} />
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="firstName" className="text-base">
          Your first name
        </Label>
        <Input
          id="firstName"
          name="firstName"
          autoComplete="given-name"
          maxLength={40}
          defaultValue={state.firstName}
          required
          className="h-12 text-lg md:text-lg"
        />
        <p className="text-sm text-muted-foreground">Your opponent sees this during the match.</p>
      </div>
      <label className="flex items-start gap-2 text-base">
        <Checkbox name="ageConfirmed" required aria-label="I confirm I am 13 years of age or older" className="mt-1" />
        I&apos;m 13 or older.
      </label>
      <Button type="submit" size="cta" disabled={pending}>
        {pending ? "Joining…" : "Join now"}
      </Button>
      <p className="text-xs text-muted-foreground">
        No account needed. By joining you agree to the{" "}
        <Link href="/terms" className="underline">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="underline">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}
