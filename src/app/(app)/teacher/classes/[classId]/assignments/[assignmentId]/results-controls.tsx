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
    <section className="flex flex-col gap-3">
      <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">By question</h2>
      <ul className="divide-y divide-border border-y border-border">
        {questions.map((q) => {
          const percent = q.answered > 0 ? Math.round((q.correct / q.answered) * 100) : null;
          const preview = previews.get(q.position);
          return (
            <li key={q.position} className="py-3">
              <button
                type="button"
                onClick={() => toggle(q.position)}
                aria-expanded={open === q.position}
                className="flex w-full items-center gap-4 text-left text-sm"
              >
                <span className="w-8 shrink-0 font-heading font-semibold tabular-nums">Q{q.position + 1}</span>
                <span className="min-w-0 flex-1 text-muted-foreground">
                  {CATEGORY_LABELS[q.category]} · {DIFFICULTY_LABELS[q.difficulty]}
                </span>
                <span className="hidden h-2 w-32 overflow-hidden rounded-full bg-foreground/10 sm:block" aria-hidden>
                  {percent !== null && <span className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />}
                </span>
                <span className="w-28 shrink-0 text-right tabular-nums">
                  {percent === null ? (
                    <span className="text-muted-foreground">no answers yet</span>
                  ) : (
                    <>
                      <span className="font-semibold">{percent}%</span>
                      <span className="text-muted-foreground"> of {q.answered}</span>
                    </>
                  )}
                </span>
              </button>
              {open === q.position && (
                <div className="mt-3 rounded-xl border border-border p-4">
                  {preview ? <AnswerKey content={preview.content} feedback={preview.feedback} /> : <p className="text-sm text-muted-foreground">Loading…</p>}
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
    <section className="flex flex-col gap-6 border-t border-border pt-8">
      <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Manage</h2>
      <form action={formAction} className="flex max-w-xl flex-col gap-3">
        <input type="hidden" name="assignmentId" value={assignmentId} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-title">Title</Label>
          <Input id="edit-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-due">Due</Label>
          <Input id="edit-due" name="dueOn" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className="w-fit" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="edit-instructions">Instructions</Label>
          <Textarea id="edit-instructions" name="instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={2000} rows={3} />
        </div>
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        {state.success && !pending && <p className="text-sm text-muted-foreground">Saved.</p>}
        <Button type="submit" variant="outline" className="w-fit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <p className="text-xs text-muted-foreground">The questions can&apos;t change once assigned — students may already be partway through.</p>
      </form>

      <div className="flex flex-wrap gap-3">
        {closed ? (
          <ConfirmButton
            title="Reopen this homework?"
            description="Students can start and answer it again right away. Nothing anyone has already done changes."
            confirmLabel="Reopen"
            onConfirm={() => setAssignmentClosedAction(assignmentId, false)}
          >
            Reopen homework
          </ConfirmButton>
        ) : (
          <ConfirmButton
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
