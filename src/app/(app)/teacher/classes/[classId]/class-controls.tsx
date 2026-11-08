"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Presentation, Printer, X } from "lucide-react";
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

/** A copy button that says what it copied; the text stays selectable if the clipboard is blocked. */
function CopyButton({ text, label, done, className }: { text: string; label: string; done: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard blocked (an http page, a locked-down Chromebook): the
          // code and link are selectable text on the page.
        }
      }}
      className={
        className ??
        "inline-flex h-11 items-center gap-2 rounded-full bg-marker px-5 text-base font-semibold text-surface-deep transition-opacity hover:opacity-90"
      }
    >
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      <span aria-live="polite">{copied ? done : label}</span>
    </button>
  );
}

const OUTLINE_BUTTON =
  "inline-flex h-11 items-center gap-2 rounded-full border border-surface-deep-foreground/40 px-5 text-base font-medium transition-colors hover:bg-surface-deep-foreground/10";

/**
 * Full-screen code for a projector or a printout: the steps and the code in
 * very large type. Escape or the Close button leaves it.
 */
function ShowToClass({ code, site, onClose }: { code: string; site: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Class code for your students"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 overflow-y-auto bg-surface-deep p-8 text-center text-surface-deep-foreground print:bg-white print:text-black"
    >
      <button ref={closeRef} type="button" onClick={onClose} className={`${OUTLINE_BUTTON} absolute top-4 right-4 print:hidden`}>
        <X className="size-4" aria-hidden /> Close
      </button>
      <p className="text-2xl font-medium sm:text-3xl">
        Go to <span className="font-semibold">{site}</span> and sign in
      </p>
      <p className="text-xl sm:text-2xl">Open Homework and enter the class code</p>
      <p className="font-mono text-7xl font-semibold tracking-[0.12em] sm:text-9xl">{code}</p>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex h-11 items-center gap-2 rounded-full bg-marker px-5 text-base font-semibold text-surface-deep print:hidden"
      >
        <Printer className="size-4" aria-hidden /> Print this
      </button>
    </div>
  );
}

/**
 * How students get into the class: the code in large type, the link, copy
 * buttons, plain steps to read out or post, a full-screen view for the
 * projector, and a new code. A student signed out when they open the link
 * signs up first and lands back on it (middleware parks the code). `empty`
 * (no students yet) makes it the lead of the page instead of a reference.
 */
export function ClassCodePanel({
  classroomId,
  className,
  code,
  joinUrl,
  site,
  shareText,
  empty = false,
  justCreated = false,
}: {
  classroomId: string;
  className: string;
  code: string;
  joinUrl: string;
  site: string;
  shareText: string;
  empty?: boolean;
  justCreated?: boolean;
}) {
  const [showing, setShowing] = useState(false);
  const close = useCallback(() => setShowing(false), []);

  return (
    <section
      aria-labelledby="add-students-heading"
      className="flex flex-col gap-6 rounded-3xl bg-surface-deep p-6 text-surface-deep-foreground sm:p-8"
    >
      <div>
        <h2 id="add-students-heading" className="text-2xl font-semibold">
          {justCreated ? `${className} is ready. Now add your students.` : empty ? "Add your students" : "Add students"}
        </h2>
        <p className="mt-1 max-w-2xl text-base text-surface-deep-foreground/80">
          Students join themselves with this code, from their own PrepHub account. You don&apos;t type anything in for
          them, and each one appears in the list below the moment they join.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[auto_1fr] lg:items-center lg:gap-10">
        <div>
          <p className="text-caption font-semibold tracking-[0.12em] text-surface-deep-foreground/60 uppercase">Class code</p>
          <p className="mt-2 font-mono text-5xl font-semibold tracking-[0.12em] sm:text-6xl">{code}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <CopyButton text={code} label="Copy code" done="Code copied" />
            <button type="button" onClick={() => setShowing(true)} className={OUTLINE_BUTTON}>
              <Presentation className="size-4" aria-hidden /> Show code to class
            </button>
          </div>
        </div>

        <ol className="flex flex-col gap-2 text-base">
          <li>
            <span className="font-semibold">1.</span> Go to <span className="font-semibold">{site}</span> and sign in, or
            make a free student account.
          </li>
          <li>
            <span className="font-semibold">2.</span> Open <span className="font-semibold">Homework</span> and type the
            class code.
          </li>
          <li>
            <span className="font-semibold">3.</span> Add your last name, so you can tell two Masons apart, then press
            Join class.
          </li>
        </ol>
      </div>

      <div className="flex flex-col gap-3 border-t border-surface-deep-foreground/20 pt-5">
        <p className="text-base font-medium">Or send them the link</p>
        <p className="text-base break-all text-surface-deep-foreground/80">{joinUrl}</p>
        <div className="flex flex-wrap items-center gap-3">
          <CopyButton text={joinUrl} label="Copy join link" done="Link copied" />
          <CopyButton text={shareText} label="Copy a message to post" done="Message copied" className={OUTLINE_BUTTON} />
          <ConfirmButton
            variant="ghost"
            size="lg"
            className="text-surface-deep-foreground/70 hover:bg-surface-deep-foreground/10 hover:text-surface-deep-foreground"
            title="Get a new class code?"
            description="The current code and link stop working immediately, and the old code can't be brought back. Students already in the class stay in it. Anyone who hasn't joined yet will need the new code."
            confirmLabel="Get a new code"
            onConfirm={() => regenerateJoinCodeAction(classroomId)}
          >
            Get a new code
          </ConfirmButton>
        </div>
      </div>

      {showing && <ShowToClass code={code} site={site} onClose={close} />}
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
