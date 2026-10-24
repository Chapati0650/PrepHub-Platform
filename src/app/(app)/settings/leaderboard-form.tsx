"use client";

import { useActionState, useEffect } from "react";
import { updateLeaderboardVisibilityAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import type { ActionState } from "@/app/(auth)/actions";

const initialState: ActionState = {};

/**
 * Whether other students at this student's school see them on the weekly
 * 1v1 Rush leaderboard. Phrased as "show me", checked by default, because
 * the board lists first names and class years to schoolmates and a student
 * should be able to read exactly what turning it off does: they disappear
 * for everyone else, and still see where they'd stand.
 */
export function LeaderboardForm({ shown, schoolName }: { shown: boolean; schoolName: string }) {
  const [state, formAction, pending] = useActionState(updateLeaderboardVisibilityAction, initialState);

  useEffect(() => {
    if (state.success) toast.add({ title: "Leaderboard setting saved", type: "success" });
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <label className="flex items-start gap-2 text-sm">
        <Checkbox name="shown" defaultChecked={shown} aria-label="Show me on my school's 1v1 Rush leaderboard" />
        <span>
          <span className="font-medium">Show me on the {schoolName} leaderboard</span>
          <br />
          <span className="text-muted-foreground">
            Other students see your first name, class year and best 1v1 Rush score this week. Turn this off and you
            disappear from their board — you&apos;ll still see where you&apos;d rank.
          </span>
        </span>
      </label>

      <Button type="submit" variant="outline" disabled={pending} className="w-fit">
        {pending ? "Saving..." : "Save leaderboard setting"}
      </Button>
    </form>
  );
}
