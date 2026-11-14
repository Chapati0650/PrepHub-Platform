"use client";

import { useActionState, useState } from "react";
import { setTeacherDisplayNameAction, type TeacherActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: TeacherActionState = {};

/**
 * "Students see you as Ms. Rivera. Change" under the teacher's greeting, with
 * the form folded inside. Open state lives here, not in the server render:
 * saving re-renders the page with the name set, and a server-decided `open`
 * would fold the form shut and take its "Saved." with it.
 */
export function TeacherNameLine({ current, firstName }: { current: string | null; firstName: string }) {
  const [open, setOpen] = useState(!current);
  return (
    <details className="group w-fit max-w-xl text-lg" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer list-none text-foreground/80 marker:hidden">
        Students see you as <span className="font-medium text-foreground">{current ?? firstName}</span>.{" "}
        <span className="font-medium text-primary underline-offset-4 group-open:hidden hover:underline dark:text-marker">Change</span>
      </summary>
      <div className="mt-4 rounded-2xl border border-border p-5">
        {!current && <p className="mb-3 text-base text-muted-foreground">Most teachers use the name their class calls them.</p>}
        <DisplayNameForm current={current} firstName={firstName} />
      </div>
    </details>
  );
}

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
      <p className="text-base text-muted-foreground">
        Shown on homework, on the join page and in the emails students get. Leave it empty to use your first name.
      </p>
      {state.error && <p className="text-base text-destructive">{state.error}</p>}
      {state.success && !pending && <p className="text-base text-muted-foreground">Saved.</p>}
    </form>
  );
}
