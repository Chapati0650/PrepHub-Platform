"use client";

import { useActionState } from "react";
import {
  confirmEmailVerificationAction,
  resendExpiredVerificationAction,
  type ConfirmState,
  type ResendExpiredState,
} from "../actions";
import { logoutAction } from "@/app/(app)/actions";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const confirmInitial: ConfirmState = {};
const resendInitial: ResendExpiredState = {};

export function ConfirmForm({ token, campuses }: { token: string; campuses: { id: string; officialName: string }[] }) {
  const [state, formAction, pending] = useActionState(confirmEmailVerificationAction, confirmInitial);

  if (state.done) {
    const enrolled = state.done.outcome === "CREATED" || state.done.outcome === "ALREADY_MEMBER";
    return (
      <div role="status" className="mt-6 flex flex-col items-start gap-4 border-t border-border pt-6">
        <p className="text-lg font-semibold">
          {enrolled
            ? "Done — Premium is on."
            : state.done.outcome === "NO_GRADE"
              ? "Confirmed. Finish signing up and Premium switches on."
              : state.done.outcome === "NEEDS_CAMPUS"
                ? "Confirmed. Pick your school after you log in and Premium switches on."
                : "Your email is confirmed."}
        </p>
        {state.done.signedInElsewhere ? (
          <>
            <p className="text-sm text-muted-foreground">
              This browser is signed in to a different PrepHub account. Log out, then log in with {state.done.email}.
            </p>
            <form action={logoutAction}>
              <Button type="submit" variant="outline">
                Log out
              </Button>
            </form>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Log in with {state.done.email} to start.</p>
            <LinkButton href="/login" size="cta" hardNavigation>
              Log in
            </LinkButton>
          </>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {campuses.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Which school do you go to?</legend>
          {campuses.map((campus) => (
            <label
              key={campus.id}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-foreground/30 has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
            >
              <input type="radio" name="schoolId" value={campus.id} required className="size-4 accent-primary" />
              <span className="font-medium">{campus.officialName}</span>
            </label>
          ))}
        </fieldset>
      )}
      <Button type="submit" size="cta" className="w-fit" disabled={pending}>
        {pending ? "Confirming…" : "Confirm and switch on Premium"}
      </Button>
    </form>
  );
}

export function ResendExpiredForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resendExpiredVerificationAction, resendInitial);
  return (
    <form action={formAction} className="mt-6 flex flex-col items-start gap-3">
      <input type="hidden" name="token" value={token} />
      <Button type="submit" size="cta" disabled={pending || Boolean(state.message)}>
        {pending ? "Sending…" : state.message ? "Sent" : "Send a new link"}
      </Button>
      {(state.message || state.error) && (
        <p role="status" className="text-sm text-muted-foreground">
          {state.message ?? state.error}
        </p>
      )}
    </form>
  );
}
