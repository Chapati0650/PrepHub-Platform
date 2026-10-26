"use client";

import { useActionState, useState, useTransition } from "react";
import type { QuestionCategory, QuestionDifficulty, QuestionType } from "@/generated/prisma/client";
import {
  deleteAssignmentAction,
  previewAssignedQuestionAction,
  setAssignmentClosedAction,
  updateAssignmentAction,
  type TeacherActionState,
} from "../../../../actions";
import type { StudentQuestionContent, StudentQuestionFeedback } from "@/lib/session/question-content";
import { CATEGORY_LABELS, DIFFICULTY_LABELS } from "@/lib/content/labels";
import { AnswerKey } from "@/components/teacher/answer-key";
import { ConfirmButton } from "@/components/confirm-button";
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
};

type Preview = { content: StudentQuestionContent; feedback: StudentQuestionFeedback };

/**
 * How the class did on each question, in the order it was assigned — the one
 * most students missed is the one to go over in class. Each opens to the
 * exact revision the class was given, with its answer key.
 */
export function QuestionBreakdown({ assignmentId, questions }: { assignmentId: string; questions: QuestionStat[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [previews, setPreviews] = useState<Map<number, Preview>>(new Map());
  const [, startLoading] = useTransition();

  function toggle(position: number) {
    if (open === position) return setOpen(null);
    setOpen(position);
    if (!previews.has(position)) {
      startLoading(async () => {
        const loaded = await previewAssignedQuestionAction(assignmentId, position);
        setPreviews((prev) => new Map(prev).set(position, loaded));
      });
    }
  }

  return (
    <section aria-labelledby="by-question-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="by-question-heading" className="text-xl">
          By question
        </h2>
        <p className="mt-1 text-base text-muted-foreground">
          How many got each one right. Open a question to see it with its answer key; the one most students missed is
          the one to go over in class.
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
                <span className="min-w-0 flex-1 text-muted-foreground">
                  {CATEGORY_LABELS[q.category]} · {DIFFICULTY_LABELS[q.difficulty]}
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
              {open === q.position && (
                <div className="mt-3 rounded-xl border border-border p-4">
                  {preview ? <AnswerKey content={preview.content} feedback={preview.feedback} /> : <p className="text-base text-muted-foreground">Loading…</p>}
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
  initial,
}: {
  assignmentId: string;
  classroomId: string;
  closed: boolean;
  canDelete: boolean;
  initial: { title: string; instructions: string; dueOn: string };
}) {
  const [state, formAction, pending] = useActionState(updateAssignmentAction, initialState);
  const [title, setTitle] = useState(initial.title);
  const [instructions, setInstructions] = useState(initial.instructions);
  const [dueOn, setDueOn] = useState(initial.dueOn);

  return (
    <section aria-labelledby="manage-heading" className="flex flex-col gap-6 border-t border-border pt-8">
      <div>
        <h2 id="manage-heading" className="text-xl">
          Change this homework
        </h2>
        <p className="mt-1 text-base text-muted-foreground">
          You can change the title, due date and instructions. The questions can&apos;t change once assigned, because
          students may already be partway through.
        </p>
      </div>
      <form action={formAction} className="flex max-w-xl flex-col gap-4">
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
            description="It disappears from your class and from every student's Homework page right away, and it can't be undone. Once any student starts it, it can only be closed."
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
