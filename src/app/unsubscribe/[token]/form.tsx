"use client";

import { useActionState } from "react";
import { unsubscribeAction, type UnsubscribeState } from "../actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initial: UnsubscribeState = {};

export function UnsubscribeForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(unsubscribeAction, initial);

  if (state.done) {
    return (
      <div role="status" className="mt-6 border-t border-border pt-6">
        <p className="text-lg font-semibold">Done. No more daily reminders.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Everything else about your account stays as it is. If you change your mind, turn them back on in Settings,
          under Notifications.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-6 flex flex-col items-start gap-4">
      <input type="hidden" name="token" value={token} />
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" size="cta" disabled={pending}>
        {pending ? "One moment…" : "Turn off daily reminders"}
      </Button>
    </form>
  );
}
