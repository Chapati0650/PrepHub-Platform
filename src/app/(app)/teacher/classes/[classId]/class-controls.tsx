"use client";

import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  regenerateJoinCodeAction,
  removeStudentAction,
  renameClassroomAction,
  setClassroomArchivedAction,
  type TeacherActionState,
} from "../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmButton } from "@/components/confirm-button";

/**
 * The code, big enough to read off a projector, and the link for a class
 * email or an LMS post. A student signed out when they open the link signs
 * up first and lands back on it (middleware parks the code).
 */
export function ClassCodePanel({ classroomId, code, joinUrl }: { classroomId: string; code: string; joinUrl: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <section className="flex flex-col gap-5 rounded-3xl bg-surface-deep p-6 text-surface-deep-foreground sm:flex-row sm:items-center sm:justify-between sm:p-8">
      <div>
        <p className="text-caption font-semibold tracking-[0.12em] text-surface-deep-foreground/60 uppercase">Class code</p>
        <p className="mt-2 font-mono text-5xl font-semibold tracking-[0.12em] sm:text-6xl">{code}</p>
        <p className="mt-3 max-w-md text-base text-surface-deep-foreground/80">
          Students go to <span className="font-medium text-surface-deep-foreground">Homework</span> in PrepHub and
          type this code, or open the link you share with them.
        </p>
      </div>
      <div className="flex flex-col items-start gap-3 sm:items-end">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(joinUrl);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard blocked (an http page, a locked-down Chromebook):
              // the link is selectable text right below.
            }
          }}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-marker px-5 text-base font-semibold text-surface-deep transition-opacity hover:opacity-90"
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? "Link copied" : "Copy join link"}
        </button>
        <p className="max-w-xs text-sm break-all text-surface-deep-foreground/70 sm:text-right">{joinUrl}</p>
        <ConfirmButton
          variant="ghost"
          size="lg"
          className="text-surface-deep-foreground/70 hover:bg-surface-deep-foreground/10 hover:text-surface-deep-foreground"
          title="Get a new class code?"
          description="The current code and link stop working immediately. Students already in the class stay in it. Anyone who hasn't joined yet will need the new code."
          confirmLabel="Get a new code"
          onConfirm={() => regenerateJoinCodeAction(classroomId)}
        >
          New code
        </ConfirmButton>
      </div>
    </section>
  );
}

export function RemoveStudentButton({
  classroomId,
  studentId,
  firstName,
}: {
  classroomId: string;
  studentId: string;
  firstName: string;
}) {
  return (
    <ConfirmButton
      variant="ghost"
      size="default"
      title={`Remove ${firstName} from this class?`}
      description={`${firstName} stops seeing this class's homework right away. Homework they've already finished stays in your results. They can rejoin with the class code, so get a new code if you need to keep them out.`}
      confirmLabel="Remove"
      destructive
      onConfirm={() => removeStudentAction(classroomId, studentId)}
    >
      Remove
    </ConfirmButton>
  );
}

const initialState: TeacherActionState = {};

export function ClassSettings({ classroomId, name, archived }: { classroomId: string; name: string; archived: boolean }) {
  const [state, formAction, pending] = useActionState(renameClassroomAction, initialState);
  const [value, setValue] = useState(name);

  return (
    <section aria-labelledby="class-settings-heading" className="flex flex-col gap-5 border-t border-border pt-8">
      <h2 id="class-settings-heading" className="text-xl">
        Class settings
      </h2>
      {!archived && (
        <form action={formAction} className="flex max-w-xl flex-col gap-2">
          <input type="hidden" name="classroomId" value={classroomId} />
          <Label htmlFor="rename" className="text-base">
            Class name
          </Label>
          <div className="flex gap-2">
            <Input
              id="rename"
              name="name"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={80}
              required
              className="h-11 text-base md:text-base"
            />
            <Button type="submit" variant="outline" size="xl" disabled={pending || value.trim() === name}>
              {pending ? "Saving…" : "Rename"}
            </Button>
          </div>
          {state.error && <p className="text-base text-destructive">{state.error}</p>}
        </form>
      )}
      <div className="flex flex-col gap-2">
        {!archived && (
          <p className="text-base text-muted-foreground">
            Finished with this class? Archiving closes it to new students and hides its homework. Nothing is deleted.
          </p>
        )}
        {archived ? (
          <ConfirmButton
            size="xl"
            className="w-fit"
            title="Restore this class?"
            description="The class code works again and its open homework reappears on students' Homework pages straight away."
            confirmLabel="Restore class"
            onConfirm={() => setClassroomArchivedAction(classroomId, false)}
          >
            Restore class
          </ConfirmButton>
        ) : (
          <ConfirmButton
            size="xl"
            className="w-fit"
            title="Archive this class?"
            description="Nobody can join, and its homework disappears from students' Homework pages right away. Nothing is deleted — every result stays here, and you can restore the class at any time."
            confirmLabel="Archive class"
            destructive
            onConfirm={() => setClassroomArchivedAction(classroomId, true)}
          >
            Archive class
          </ConfirmButton>
        )}
      </div>
    </section>
  );
}
