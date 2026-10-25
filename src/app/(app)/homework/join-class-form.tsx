"use client";

import { useActionState } from "react";
import { joinClassAction, leaveClassAction, type JoinState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmButton } from "@/components/confirm-button";

const initialState: JoinState = {};

export function JoinClassForm({ defaultCode = "" }: { defaultCode?: string }) {
  const [state, formAction, pending] = useActionState(joinClassAction, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Label htmlFor="class-code" className="sr-only">
        Class code
      </Label>
      <div className="flex gap-2">
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
        <Button type="submit" disabled={pending} className="shrink-0">
          {pending ? "Joining…" : "Join class"}
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
