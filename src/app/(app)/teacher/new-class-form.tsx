"use client";

import { useActionState } from "react";
import { createClassroomAction, type TeacherActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: TeacherActionState = {};

export function NewClassForm() {
  const [state, formAction, pending] = useActionState(createClassroomAction, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <Label htmlFor="class-name" className="sr-only">
        Class name
      </Label>
      <div className="flex gap-2">
        <Input id="class-name" name="name" placeholder="e.g. 3rd period SAT Prep" maxLength={80} required />
        <Button type="submit" disabled={pending} className="shrink-0">
          {pending ? "Creating…" : "Create class"}
        </Button>
      </div>
    </form>
  );
}
