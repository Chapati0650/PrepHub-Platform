"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import type { QuestionCategory, QuestionDifficulty, QuestionType } from "@/generated/prisma/client";
import {
  assignToMoreClassesAction,
  deleteAssignmentAction,
  previewAssignedQuestionAction,
  remindUnfinishedAction,
  setAssignmentClosedAction,
  updateAssignmentAction,
  type TeacherActionState,
} from "../../../../actions";
import type { StudentQuestionContent, StudentQuestionFeedback } from "@/lib/session/question-content";
import type { AnswerBreakdown } from "@/lib/teacher/answer-stats";
import { CATEGORY_LABELS, DIFFICULTY_LABELS } from "@/lib/content/labels";
import { AnswerKey } from "@/components/teacher/answer-key";
import { ConfirmButton } from "@/components/confirm-button";
import { StaffField, StatusChip } from "@/components/staff/staff-ui";
import { ActionFailureNote, actionFailure, type ActionFailure } from "@/components/staff/action-failure";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type QuestionStat = {
  position: number;
  questionId: string;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  questionType: QuestionType;
  answered: number;
  correct: number;
  correctAnswer: string;
  breakdown: AnswerBreakdown;
  mostMissed: boolean;
};

/**
 * What the class answered on one question, in a line: every choice's count
 * (the right one marked in words, not just colour), or a grid-in's most
 * common wrong entries. A wrong answer most of the class chose is called
 * out, because that's a misconception to reteach rather than guessing.
 */
function BreakdownLine({ breakdown }: { breakdown: AnswerBreakdown }) {
  if (breakdown.answered === 0) return null;
  if (breakdown.kind === "choices") {
    return (
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-14 text-base tabular-nums">
        {breakdown.choices.map((c) => (
          <span
            key={c.label}
            className={
              c.correct
                ? "font-semibold text-green-800 dark:text-green-300"
                : c.label === breakdown.commonWrong
                  ? "font-semibold text-destructive"
                  : "text-muted-foreground"
            }
          >
            {c.label} {c.count}
            {c.correct && <span className="font-normal"> (right)</span>}
          </span>
        ))}
        {breakdown.commonWrong && (
          <span className="text-sm text-muted-foreground">
            Most common wrong answer: {breakdown.commonWrong}.
          </span>
        )}
      </p>
    );
  }
  return (
    <p className="mt-2 pl-14 text-base text-muted-foreground">
      <span className="font-semibold text-green-800 dark:text-green-300">
        {breakdown.correctCount} answered {breakdown.correctAnswer} (right)
      </span>
      {breakdown.wrong.length > 0 && (
        <>
          {" "}
          · Most common wrong answers: {breakdown.wrong.map((w) => `${w.value} (${w.count})`).join(", ")}
        </>
      )}
    </p>
  );
}

type Preview = { content: StudentQuestionContent; feedback: StudentQuestionFeedback };

/**
 * How the class did on each question, in the order it was assigned — the one
 * most students missed is the one to go over in class. Each opens to the
 * exact revision the class was given, with its answer key.
 */
export function QuestionBreakdown({ assignmentId, questions }: { assignmentId: string; questions: QuestionStat[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [previews, setPreviews] = useState<Map<number, Preview>>(new Map());
  const [failed, setFailed] = useState<{ position: number; failure: ActionFailure } | null>(null);
  const [, startLoading] = useTransition();

  // Caught, so a failed preview (a deploy since the page opened, the
  // connection) says so in place instead of taking the results page down.
  function load(position: number) {
    setFailed(null);
    startLoading(async () => {
      try {
        const loaded = await previewAssignedQuestionAction(assignmentId, position);
        setPreviews((prev) => new Map(prev).set(position, loaded));
      } catch (err) {
        setFailed({ position, failure: actionFailure(err, "Couldn't open this question just now. Try again.") });
      }
    });
  }

  function toggle(position: number) {
    if (open === position) return setOpen(null);
    setOpen(position);
    if (!previews.has(position)) load(position);
  }

  return (
    <section aria-labelledby="by-question-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="by-question-heading" className="text-xl">
          By question
        </h2>
        <p className="mt-1 text-base text-muted-foreground">
          How many got each one right, and what they answered. Open a question to see it with its answer key; the ones
          marked &ldquo;Most missed&rdquo; are the ones to go over in class.
        </p>
      </div>
      <ul className="divide-y divide-border rounded-2xl border border-border">
        {questions.map((q) => {
          const percent = q.answered > 0 ? Math.round((q.correct / q.answered) * 100) : null;
          const preview = previews.get(q.position);
          return (
            <li key={q.position} className="px-5 py-4">
              <button
                type="button"
                onClick={() => toggle(q.position)}
                aria-expanded={open === q.position}
                className="flex w-full items-center gap-4 text-left text-base"
              >
                <span className="w-10 shrink-0 font-heading font-semibold tabular-nums">Q{q.position + 1}</span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-muted-foreground">
                  {CATEGORY_LABELS[q.category]} · {DIFFICULTY_LABELS[q.difficulty]}
                  {q.mostMissed && <StatusChip tone="bad">Most missed</StatusChip>}
                </span>
                <span className="hidden h-2 w-32 overflow-hidden rounded-full bg-foreground/10 sm:block" aria-hidden>
                  {percent !== null && <span className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />}
                </span>
                <span className="w-36 shrink-0 text-right tabular-nums">
                  {percent === null ? (
                    <span className="text-muted-foreground">No answers yet</span>
                  ) : (
                    <>
                      <span className="font-semibold">{percent}%</span>
                      <span className="text-muted-foreground"> right, of {q.answered}</span>
                    </>
                  )}
                </span>
              </button>
              <BreakdownLine breakdown={q.breakdown} />
              {open === q.position && (
                <div className="mt-3 rounded-xl border border-border p-4">
                  {preview ? (
                    <AnswerKey content={preview.content} feedback={preview.feedback} />
                  ) : failed?.position === q.position ? (
                    <ActionFailureNote failure={failed.failure} onRetry={() => load(q.position)} />
                  ) : (
                    <p className="text-base text-muted-foreground">Loading…</p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const initialState: TeacherActionState = {};

export function AssignmentControls({
  assignmentId,
  classroomId,
  closed,
  canDelete,
  canChangeMode,
  initial,
}: {
  assignmentId: string;
  classroomId: string;
  closed: boolean;
  canDelete: boolean;
  /** Only until a student starts: a quiz turned into practice halfway would treat students differently. */
  canChangeMode: boolean;
  initial: { title: string; instructions: string; dueOn: string; mode: "PRACTICE" | "QUIZ" };
}) {
  const [state, formAction, pending] = useActionState(updateAssignmentAction, initialState);
  const [, startSaving] = useTransition();
  const [title, setTitle] = useState(initial.title);
  const [instructions, setInstructions] = useState(initial.instructions);
  const [dueOn, setDueOn] = useState(initial.dueOn);
  const [mode, setMode] = useState(initial.mode);

  return (
    <section aria-labelledby="manage-heading" className="flex flex-col gap-6 border-t border-border pt-8">
      <div>
        <h2 id="manage-heading" className="text-xl">
          Change this homework
        </h2>
        <p className="mt-1 text-base text-muted-foreground">
          You can change the title, due date and instructions
          {canChangeMode ? ", and whether it's practice or a quiz until a student starts it" : ""}. The questions
          can&apos;t change once assigned, because students may already be partway through.
        </p>
      </div>
      {/* onSubmit rather than `action`: React resets a form after an action
          completes, which would put the mode radios back on the value they
          started with while the saved one stays in state (CLAUDE.md, College
          Apps gotcha). */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          startSaving(() => formAction(data));
        }}
        className="flex max-w-xl flex-col gap-4"
      >
        <input type="hidden" name="assignmentId" value={assignmentId} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-title" className="text-base">
            Title
          </Label>
          <Input
            id="edit-title"
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            required
            className="h-11 text-base md:text-base"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-due" className="text-base">
            Due date
          </Label>
          <Input
            id="edit-due"
            name="dueOn"
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            className="h-11 w-fit text-base md:text-base"
          />
        </div>
        {canChangeMode && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-base font-medium">How students do it</legend>
            {(["PRACTICE", "QUIZ"] as const).map((m) => (
              <label key={m} className="flex items-center gap-2.5 text-base">
                <input
                  type="radio"
                  name="mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  className="size-4 accent-primary"
                />
                {m === "PRACTICE" ? "Practice: explanation after each answer" : "Quiz: answers shown when turned in"}
              </label>
            ))}
            {/* The "new homework" email went out with the mode it had then,
                and an email can't be changed after it's sent. */}
            <p className="text-sm text-muted-foreground">
              The email students got when you assigned it said it was{" "}
              {initial.mode === "QUIZ" ? "a quiz" : "practice"}. If you change it, let them know.
            </p>
          </fieldset>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-instructions" className="text-base">
            Instructions
          </Label>
          <Textarea
            id="edit-instructions"
            name="instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            maxLength={2000}
            rows={3}
            className="text-base md:text-base"
          />
        </div>
        {state.error && <p className="text-base text-destructive">{state.error}</p>}
        {state.success && !pending && <p className="text-base text-muted-foreground">Saved.</p>}
        <Button type="submit" variant="outline" size="xl" className="w-fit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </form>

      <div className="flex flex-wrap gap-3">
        {closed ? (
          <ConfirmButton
            size="xl"
            title="Reopen this homework?"
            description="Students can start and answer it again right away. Nothing anyone has already done changes."
            confirmLabel="Reopen"
            onConfirm={() => setAssignmentClosedAction(assignmentId, false)}
          >
            Reopen homework
          </ConfirmButton>
        ) : (
          <ConfirmButton
            size="xl"
            title="Close this homework?"
            description="From now on nobody can start it or answer more of it, including students partway through. Everything already answered stays in these results. You can reopen it at any time."
            confirmLabel="Close homework"
            onConfirm={() => setAssignmentClosedAction(assignmentId, true)}
          >
            Close homework
          </ConfirmButton>
        )}
        {canDelete && (
          <ConfirmButton
            size="xl"
            title="Delete this homework?"
            description="It disappears from your class and from every student's Homework page right away, and it can't be undone. Students in the class when you assigned it were emailed a link to it, and that link will stop working. Once any student starts it, it can only be closed."
            confirmLabel="Delete"
            destructive
            onConfirm={() => deleteAssignmentAction(assignmentId, classroomId)}
          >
            Delete
          </ConfirmButton>
        )}
      </div>
    </section>
  );
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/**
 * "Remind the N who haven't finished": the way to chase missing work without
 * leaving PrepHub. Who gets it is decided on the server by the same rule as
 * the count on the button (needsNudge). Times arrive already formatted, in
 * the school's zone, so the server and the browser can't print them
 * differently.
 */
export function RemindPanel({
  assignmentId,
  className,
  recipients,
  pastDue,
  lastSent,
  nextAllowed,
}: {
  assignmentId: string;
  className: string;
  recipients: number;
  pastDue: boolean;
  /** "Nov 1, 3:15 PM", or null if no reminder has gone. */
  lastSent: string | null;
  /** When the next may go, or null if it can go now. */
  nextAllowed: string | null;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  if (recipients === 0 && !lastSent && !notice) return null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-base">
        {recipients === 0 ? (
          <p>Everyone in the class has turned it in.</p>
        ) : (
          <p>
            <span className="font-medium">{plural(recipients, "student")}</span> in the class{" "}
            {recipients === 1 ? "hasn't" : "haven't"} turned it in
            {pastDue ? ", and it's past due." : " yet."}
          </p>
        )}
        {notice ? (
          <p role="status" className="mt-1 text-muted-foreground">
            {notice}
          </p>
        ) : (
          lastSent && (
            <p className="mt-1 text-muted-foreground">
              You last sent a reminder {lastSent}.
              {nextAllowed && ` You can send the next one after ${nextAllowed}.`}
            </p>
          )
        )}
      </div>
      {recipients > 0 && !nextAllowed && !notice && (
        <ConfirmButton
          size="xl"
          className="shrink-0"
          title={`Email a reminder to ${plural(recipients, "student")}?`}
          description={`PrepHub emails the ${plural(recipients, "student")} in ${className} who ${recipients === 1 ? "hasn't" : "haven't"} turned it in, right away, with a link to it${pastDue ? " and a note that it's past due and still accepted" : ""}. Students who have finished, who joined after it was due, or who have left the class aren't emailed. An email can't be unsent, and you can send the next reminder in 24 hours.`}
          confirmLabel="Send reminder"
          onConfirm={async () => {
            try {
              const result = await remindUnfinishedAction(assignmentId);
              if (result.error) return result;
              setNotice(
                result.sent
                  ? `Reminder sent to ${plural(result.sent, "student")}.`
                  : "Nobody needed a reminder: everyone has turned it in.",
              );
              return result;
            } catch (err) {
              return { error: actionFailure(err, "Couldn't send the reminder just now. Try again in a moment.").message };
            }
          }}
        >
          Remind the {recipients} who {recipients === 1 ? "hasn't" : "haven't"} finished
        </ConfirmButton>
      )}
    </div>
  );
}

/**
 * "Assign to another class": the same homework for more of the teacher's
 * open classes, with a new due date — next year's periods, or the class that
 * was a day behind. Mode, title, instructions and the very question versions
 * this class had are kept (assignToMoreClasses); each class gets its own
 * copy and its students are emailed, exactly as from the builder.
 */
export function AssignAgainPanel({
  assignmentId,
  otherClasses,
  mode,
  questionCount,
}: {
  assignmentId: string;
  otherClasses: { id: string; name: string }[];
  mode: "PRACTICE" | "QUIZ";
  questionCount: number;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [dueOn, setDueOn] = useState("");
  const [pending, startAssigning] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [made, setMade] = useState<{ classroomId: string; assignmentId: string; name: string }[]>([]);

  function toggle(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setError(null);
    setFailure(null);
    const classroomIds = [...chosen];
    startAssigning(async () => {
      try {
        const result = await assignToMoreClassesAction(assignmentId, { classroomIds, dueOn });
        if ("error" in result) return setError(result.error);
        setMade(
          result.created.map((c) => ({ ...c, name: otherClasses.find((o) => o.id === c.classroomId)?.name ?? "Class" })),
        );
        setChosen(new Set());
      } catch (err) {
        setFailure(
          actionFailure(
            err,
            "Couldn't confirm it was assigned. Check those classes' pages before trying again, so it isn't assigned twice.",
          ),
        );
      }
    });
  }

  return (
    <section aria-labelledby="assign-again-heading" className="flex flex-col gap-4 border-t border-border pt-8">
      <div>
        <h2 id="assign-again-heading" className="text-xl">
          Assign to another class
        </h2>
        <p className="mt-1 text-base text-muted-foreground">
          The same {plural(questionCount, "question")}, title and instructions, as {mode === "QUIZ" ? "a quiz" : "practice"},
          with a new due date. Each class gets its own copy and its own results, and its students are emailed.
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex max-w-xl flex-col gap-4"
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-base font-medium">Classes</legend>
          {otherClasses.map((c) => (
            <label key={c.id} className="flex items-center gap-2.5 text-base">
              <input
                type="checkbox"
                checked={chosen.has(c.id)}
                onChange={() => toggle(c.id)}
                className="size-4.5 accent-primary"
              />
              {c.name}
            </label>
          ))}
        </fieldset>
        <StaffField
          label="Due date"
          htmlFor="again-due"
          optional
          hint="Due at the end of that day, Central time, like any homework."
        >
          <Input
            id="again-due"
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            className="h-11 w-fit text-base md:text-base"
          />
        </StaffField>
        {error && <p className="text-base text-destructive">{error}</p>}
        {failure && <ActionFailureNote failure={failure} />}
        {made.length > 0 && (
          <div role="status" className="text-base">
            <p className="font-medium">
              Assigned to {made.map((m) => m.name).join(", ")}. Each copy has its own results:
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {made.map((m) => (
                <li key={m.assignmentId}>
                  <Link
                    href={`/teacher/classes/${m.classroomId}/assignments/${m.assignmentId}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Open {m.name}&apos;s copy
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Button type="submit" variant="outline" size="xl" className="w-fit" disabled={pending || chosen.size === 0}>
          {pending
            ? "Assigning…"
            : chosen.size > 1
              ? `Assign to ${chosen.size} classes`
              : "Assign to class"}
        </Button>
      </form>
    </section>
  );
}
