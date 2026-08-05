"use client";

import { useActionState } from "react";
import { deleteAccountAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ActionState } from "@/app/(auth)/actions";

const initialState: ActionState = {};

export function DeleteAccountForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, formAction, pending] = useActionState(deleteAccountAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {hasPassword && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Confirm your password</Label>
          <Input id="password" name="password" type="password" required />
        </div>
      )}

      <Button type="submit" variant="destructive" disabled={pending}>
        {pending ? "Deleting..." : "Delete my account"}
      </Button>
    </form>
  );
}
