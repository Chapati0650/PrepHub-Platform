"use client";

import { useActionState } from "react";
import { updateTargetScoreAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ActionState } from "@/app/(auth)/actions";

const initialState: ActionState = {};

export function TargetScoreForm({ currentTargetScore }: { currentTargetScore: number | null }) {
  const [state, formAction, pending] = useActionState(updateTargetScoreAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="targetScore">Target SAT score</Label>
        <Input
          id="targetScore"
          name="targetScore"
          type="number"
          min={400}
          max={1600}
          step={10}
          defaultValue={currentTargetScore ?? ""}
          placeholder="e.g. 1500"
          className="max-w-40"
        />
        <p className="text-xs text-muted-foreground">Used to show your progress toward a goal. Leave blank to clear it.</p>
      </div>

      <Button type="submit" variant="outline" disabled={pending} className="w-fit">
        {pending ? "Saving..." : "Save target score"}
      </Button>
    </form>
  );
}
