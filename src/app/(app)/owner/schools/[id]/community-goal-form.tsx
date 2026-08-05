"use client";

import { useActionState } from "react";
import { updateCommunityGoalAction, type ActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: ActionState = {};

const METRIC_OPTIONS = [
  { value: "", label: "No active goal" },
  { value: "QUESTIONS_ANSWERED", label: "Questions Answered" },
  { value: "STUDY_HOURS", label: "Study Hours" },
  { value: "ADAPTIVE_SESSIONS", label: "Adaptive Sessions" },
] as const;

// PRD-009 §7 — Owner-configured, one active goal per school. Shown on the
// School Community page as a progress bar toward `communityGoalTarget`.
export function CommunityGoalForm({
  id,
  communityGoalMetric,
  communityGoalTarget,
}: {
  id: string;
  communityGoalMetric: string | null;
  communityGoalTarget: number | null;
}) {
  const [formState, formAction, pending] = useActionState(updateCommunityGoalAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={id} />
      {formState.error && (
        <Alert variant="destructive">
          <AlertDescription>{formState.error}</AlertDescription>
        </Alert>
      )}
      {formState.success && <p className="text-sm text-muted-foreground">Saved.</p>}

      <div className="flex flex-col gap-2">
        <Label htmlFor="communityGoalMetric">Goal metric</Label>
        <Select name="communityGoalMetric" defaultValue={communityGoalMetric ?? ""}>
          <SelectTrigger id="communityGoalMetric">
            <SelectValue placeholder="No active goal" />
          </SelectTrigger>
          <SelectContent>
            {METRIC_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="communityGoalTarget">Goal target</Label>
        <Input
          id="communityGoalTarget"
          name="communityGoalTarget"
          type="number"
          min={1}
          defaultValue={communityGoalTarget ?? ""}
          placeholder="e.g. 100000"
          className="max-w-40"
        />
      </div>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving..." : "Save goal"}
      </Button>
    </form>
  );
}
