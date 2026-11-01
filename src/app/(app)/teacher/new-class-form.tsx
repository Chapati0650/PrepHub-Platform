"use client";

import { startTransition, useActionState } from "react";
import { createClassroomAction, type TeacherActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StaffField } from "@/components/staff/staff-ui";

const initialState: TeacherActionState = {};

export function NewClassForm() {
  const [state, formAction, pending] = useActionState(createClassroomAction, initialState);
  return (
    // onSubmit rather than `action`: React resets a form after an action
    // completes, so a refused name ("archive one first", too long) was wiped
    // along with the error explaining it. Success redirects to the class.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="flex flex-col gap-4"
    >
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription className="text-base">{state.error}</AlertDescription>
        </Alert>
      )}
      <StaffField label="Class name" htmlFor="class-name">
        <Input
          id="class-name"
          name="name"
          placeholder="e.g. 3rd period SAT Prep"
          maxLength={80}
          required
          className="h-11 text-base md:text-base"
        />
      </StaffField>
      <Button type="submit" size="xl" disabled={pending} className="w-fit">
        {pending ? "Creating…" : "Create class"}
      </Button>
    </form>
  );
}
