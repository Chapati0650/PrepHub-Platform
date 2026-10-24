"use client";

import { useActionState } from "react";
import { setRushLeaderboardAction, type ActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: ActionState = {};

/**
 * The per-organization switch for the weekly 1v1 Rush leaderboard. Exists
 * for the district whose data agreement doesn't let students see each
 * other's names and scores: turning it off here removes the board for every
 * student at this school — or, on a district, at every school in it.
 */
export function RushLeaderboardForm({ id, enabled, isDistrict }: { id: string; enabled: boolean; isDistrict: boolean }) {
  const [state, formAction, pending] = useActionState(setRushLeaderboardAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={id} />
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.success && (
        <Alert>
          <AlertDescription>Saved.</AlertDescription>
        </Alert>
      )}
      <label className="flex items-start gap-2 text-sm">
        <Checkbox name="enabled" defaultChecked={enabled} aria-label="Show the weekly 1v1 Rush leaderboard" />
        <span>
          <span className="font-medium">Show the weekly 1v1 Rush leaderboard</span>
          <br />
          <span className="text-muted-foreground">
            {isDistrict
              ? "Off here turns it off at every school in this district, whatever each school's own setting says."
              : "Students here see each other's first names, class years and best scores this week. Each student can still hide themselves in Settings."}
          </span>
        </span>
      </label>
      <Button type="submit" variant="outline" disabled={pending} className="w-fit">
        {pending ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}
