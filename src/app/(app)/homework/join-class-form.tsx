"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { joinClassAction, leaveClassAction, setClassLastNameAction, type JoinState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmButton } from "@/components/confirm-button";

const initialState: JoinState = {};

/**
 * Submits through onSubmit rather than `<form action>`: React resets a form
 * after an action completes, so a mistyped code came back as an error above
 * two empty boxes (or, from a join link, the link's code again), and the
 * student had to type their last name a second time to fix one letter.
 */
function submitWith(dispatch: (data: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => dispatch(data));
  };
}

/**
 * The class code and the student's last name. The account only ever holds a
 * first name (PRD-001); a class needs the last name too, so a teacher with
 * two students called Mason can tell them apart. It's given to this class
 * and nobody else, and the form says so.
 */
export function JoinClassForm({ defaultCode = "" }: { defaultCode?: string }) {
  const [state, formAction, pending] = useActionState(joinClassAction, initialState);
  return (
    <form onSubmit={submitWith(formAction)} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="class-code">Class code</Label>
        <Input
          id="class-code"
          name="code"
          defaultValue={defaultCode}
          placeholder="ABC-DEF"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={9}
          className="font-mono tracking-wider uppercase"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="class-last-name">Your last name</Label>
        <Input id="class-last-name" name="lastName" autoComplete="family-name" maxLength={60} required />
        <p className="text-xs text-muted-foreground">
          So your teacher knows it&apos;s you. Only this class&apos;s teacher sees it.
        </p>
      </div>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Joining…" : "Join class"}
      </Button>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

/** For a student who joined before classes asked for a last name. */
export function ClassLastNameForm({ classroomId, className }: { classroomId: string; className: string }) {
  const [state, formAction, pending] = useActionState(setClassLastNameAction, initialState);
  if (state.success) return null;
  const id = `last-name-${classroomId}`;
  return (
    <form onSubmit={submitWith(formAction)} className="mt-2 flex flex-col gap-1.5 rounded-lg bg-surface-tint p-3">
      <input type="hidden" name="classroomId" value={classroomId} />
      <Label htmlFor={id} className="text-sm font-normal">
        Add your last name so the teacher of {className} knows it&apos;s you. Only they see it.
      </Label>
      <div className="flex gap-2">
        <Input id={id} name="lastName" autoComplete="family-name" maxLength={60} required className="max-w-56" />
        <Button type="submit" size="lg" disabled={pending} className="shrink-0">
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}

export function LeaveClassButton({ classroomId, className }: { classroomId: string; className: string }) {
  return (
    <ConfirmButton
      variant="ghost"
      size="xs"
      title={`Leave ${className}?`}
      description="Its homework disappears from your list right away. Work you've finished stays with your teacher, and you can rejoin with the class code."
      confirmLabel="Leave class"
      onConfirm={() => leaveClassAction(classroomId)}
    >
      Leave
    </ConfirmButton>
  );
}
