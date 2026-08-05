"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { completeSchoolVerificationAction, type ActionState } from "../../actions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: ActionState = {};

export function CompleteVerification({
  token,
  organizationName,
  requiresSchoolSelection,
  schools,
}: {
  token: string;
  organizationName: string;
  requiresSchoolSelection: boolean;
  schools: { id: string; officialName: string }[];
}) {
  const [state, formAction, pending] = useActionState(completeSchoolVerificationAction, initialState);
  const autoSubmitted = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  // PRD-002 §8.4: verification completes immediately once the link is opened
  // while signed into the right account — no extra click when there's nothing
  // to choose. The mutation still runs through the server action (not during
  // this page's render) so opening/prefetching the page has no side effects.
  useEffect(() => {
    if (!requiresSchoolSelection && !autoSubmitted.current) {
      autoSubmitted.current = true;
      formRef.current?.requestSubmit();
    }
  }, [requiresSchoolSelection]);

  if (requiresSchoolSelection) {
    return (
      <form ref={formRef} action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="token" value={token} />

        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="schoolId">Select Your School</Label>
          <p className="text-xs text-muted-foreground">
            {organizationName} has multiple schools — pick yours to finish verification.
          </p>
          <Select name="schoolId" required>
            <SelectTrigger id="schoolId" className="w-full">
              <SelectValue placeholder="Select your school" />
            </SelectTrigger>
            <SelectContent>
              {schools.map((school) => (
                <SelectItem key={school.id} value={school.id}>
                  {school.officialName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? "Verifying..." : "Finish Verification"}
        </Button>
      </form>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />

      {state.error ? (
        <>
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
          <Link href="/access" className="text-sm underline">
            Back to access options
          </Link>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Verifying your school email...</p>
      )}
    </form>
  );
}
