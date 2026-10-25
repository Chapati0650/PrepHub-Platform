"use client";

import { useActionState } from "react";
import { chooseCampusAction, type CampusState } from "../actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: CampusState = {};

/**
 * Radio cards rather than a select: a district has a handful of high schools,
 * and seeing them all at once is quicker than opening a menu to find yours.
 */
export function CampusForm({ campuses }: { campuses: { id: string; officialName: string }[] }) {
  const [state, formAction, pending] = useActionState(chooseCampusAction, initialState);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Your school</legend>
        {campuses.map((campus) => (
          <label
            key={campus.id}
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-foreground/30 has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
          >
            <input type="radio" name="schoolId" value={campus.id} required className="size-4 accent-primary" />
            <span className="font-medium">{campus.officialName}</span>
          </label>
        ))}
      </fieldset>
      <Button type="submit" size="cta" disabled={pending}>
        {pending ? "Switching on…" : "Switch on Premium"}
      </Button>
    </form>
  );
}
