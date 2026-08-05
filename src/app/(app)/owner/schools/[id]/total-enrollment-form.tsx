"use client";

import { useActionState } from "react";
import { updateTotalEnrollmentAction, type ActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: ActionState = {};

// PRD-011 §9 — the eligible student population PrepHub establishes for this
// school; Administrators can see it but never edit it. Left blank, the Admin
// Overview page shows "—" for Registration Percentage rather than dividing
// by a missing/zero denominator.
export function TotalEnrollmentForm({ id, totalEnrollment }: { id: string; totalEnrollment: number | null }) {
  const [formState, formAction, pending] = useActionState(updateTotalEnrollmentAction, initialState);

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
        <Label htmlFor="totalEnrollment">Total School Enrollment</Label>
        <Input
          id="totalEnrollment"
          name="totalEnrollment"
          type="number"
          min={0}
          defaultValue={totalEnrollment ?? ""}
          placeholder="e.g. 2100"
          className="max-w-40"
        />
      </div>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving..." : "Save enrollment"}
      </Button>
    </form>
  );
}
