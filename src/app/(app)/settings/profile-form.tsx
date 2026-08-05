"use client";

import { useActionState } from "react";
import { updateFirstNameAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ActionState } from "@/app/(auth)/actions";

const initialState: ActionState = {};

// PRD-010 §5 — only First Name is editable.
export function ProfileForm({ firstName }: { firstName: string }) {
  const [state, formAction, pending] = useActionState(updateFirstNameAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="firstName">First name</Label>
        <Input id="firstName" name="firstName" defaultValue={firstName} required className="max-w-64" />
      </div>

      <Button type="submit" variant="outline" disabled={pending} className="w-fit">
        {pending ? "Saving..." : "Save name"}
      </Button>
    </form>
  );
}
