"use client";

import { useActionState } from "react";
import { updateNotificationPrefsAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ActionState } from "@/app/(auth)/actions";

const initialState: ActionState = {};

// PRD-010 §7 — Daily Practice Reminder is the only independent toggle;
// Streak Lost Email is always-on ("cannot be disabled independently") so it's
// shown as informational text only, with no control.
export function NotificationsForm({ dailyReminderEnabled }: { dailyReminderEnabled: boolean }) {
  const [state, formAction, pending] = useActionState(updateNotificationPrefsAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <label className="flex items-start gap-2 text-sm">
        <Checkbox name="dailyReminderEnabled" defaultChecked={dailyReminderEnabled} aria-label="Daily Practice Reminder" />
        <span>
          <span className="font-medium">Daily Practice Reminder</span>
          <br />
          <span className="text-muted-foreground">A daily nudge to complete a practice session, especially if your study streak is at risk.</span>
        </span>
      </label>

      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Streak Lost Email</span> — sent automatically if your study streak ends. This is
        part of the learning experience and can&apos;t be turned off separately.
      </p>

      <Button type="submit" variant="outline" disabled={pending} className="w-fit">
        {pending ? "Saving..." : "Save notification settings"}
      </Button>
    </form>
  );
}
