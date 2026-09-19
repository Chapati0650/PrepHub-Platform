"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createLessonAction, createModuleAction, type CurriculumActionState } from "./actions";

const initial: CurriculumActionState = {};

export function ModuleForms() {
  const [state, action, pending] = useActionState(createModuleAction, initial);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl border border-border p-5 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col gap-2">
        <Label htmlFor="new-module-title">New module</Label>
        <Input id="new-module-title" name="title" placeholder="e.g. Reading & Writing: Grammar" required maxLength={120} />
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      </div>
      <Button type="submit" disabled={pending} className="rounded-full">
        {pending ? "Adding…" : "Add module"}
      </Button>
    </form>
  );
}

// Creating a lesson takes only a title and opens its editor — the video,
// description and publish state are set there, so a half-configured lesson
// is never left sitting in the list without the Owner having seen it.
export function NewLessonForm({ moduleId }: { moduleId: string }) {
  const [state, action, pending] = useActionState(createLessonAction, initial);
  return (
    <form action={action} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input type="hidden" name="moduleId" value={moduleId} />
      <Input name="title" placeholder="New lesson title" required maxLength={120} className="sm:max-w-sm" aria-label="New lesson title" />
      <Button type="submit" variant="outline" disabled={pending} className="rounded-full">
        {pending ? "Adding…" : "Add lesson"}
      </Button>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
