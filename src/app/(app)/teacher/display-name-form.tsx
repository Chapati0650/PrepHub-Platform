"use client";

import { useActionState, useState } from "react";
import { setTeacherDisplayNameAction, type TeacherActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: TeacherActionState = {};

/** The name students see on homework, emails and the join page. */
export function DisplayNameForm({ current, firstName }: { current: string | null; firstName: string }) {
  const [state, formAction, pending] = useActionState(setTeacherDisplayNameAction, initialState);
  const [value, setValue] = useState(current ?? "");
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Label htmlFor="teacher-display-name" className="text-base">
        Your name for students
      </Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="teacher-display-name"
          name="displayName"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`e.g. Ms. Alvarez (now: ${firstName})`}
          maxLength={60}
          className="h-11 max-w-xs text-base md:text-base"
        />
        <Button type="submit" variant="outline" size="xl" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Shown on homework, on the join page and in the emails students get. Leave it empty to use your first name.
      </p>
      {state.error && <p className="text-base text-destructive">{state.error}</p>}
      {state.success && !pending && <p className="text-base text-muted-foreground">Saved.</p>}
    </form>
  );
}
