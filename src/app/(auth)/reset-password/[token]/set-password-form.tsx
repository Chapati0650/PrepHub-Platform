"use client";

import Link from "next/link";
import { useActionState } from "react";
import { confirmPasswordResetAction, type ActionState } from "../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: ActionState = {};

export function SetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(confirmPasswordResetAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>
            {state.error}{" "}
            <Link href="/reset-password" className="font-medium underline underline-offset-4">
              Get a new link
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <input type="hidden" name="token" value={token} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        <p className="text-sm text-muted-foreground">At least 8 characters.</p>
      </div>

      <Button type="submit" size="lg" className="h-12 text-base" disabled={pending}>
        {pending ? "Saving..." : "Set password"}
      </Button>
    </form>
  );
}
