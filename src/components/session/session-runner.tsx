"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LatexText } from "@/components/content/latex-text";
import { CALCULATOR_LABELS } from "@/lib/content/labels";
import type { StudentQuestionContent, StudentQuestionFeedback } from "@/lib/session/question-content";
import { Calculator } from "./calculator";
import { TimerBadge } from "./timer-badge";
import { SessionNavGrid, type NavItemState } from "./session-nav-grid";

export type SessionRunnerItem = {
  id: string;
  position: number;
  submitted: boolean;
  studentAnswer: string | null;
  isCorrect: boolean | null;
  draftAnswer: string | null;
  skipped: boolean;
};

export type LoadedQuestion = { content: StudentQuestionContent; feedback: StudentQuestionFeedback | null };

export type SessionRunnerProps = {
  title: string;
  initialItems: SessionRunnerItem[];
  initialPosition: number;
  initialQuestion: LoadedQuestion;
  allowBlankConfirmation: boolean;
  loadQuestion: (itemId: string) => Promise<LoadedQuestion>;
  saveDraft: (itemId: string, patch: { draftAnswer?: string | null; skipped?: boolean }) => Promise<void>;
  savePosition: (position: number) => Promise<void>;
  submitAnswer: (itemId: string, answer: string) => Promise<{ isCorrect: boolean; feedback: StudentQuestionFeedback; studentAnswer: string }>;
  complete: (options: { confirmBlanks: boolean }) => Promise<{ ok: true; redirectTo: string } | { ok: false; unansweredCount: number }>;
};

export function SessionRunner(props: SessionRunnerProps) {
  const router = useRouter();
  const [items, setItems] = useState(props.initialItems);
  const [position, setPosition] = useState(props.initialPosition);
  const [cache, setCache] = useState<Map<string, LoadedQuestion>>(
    new Map([[props.initialItems[props.initialPosition].id, props.initialQuestion]]),
  );
  const [draft, setDraft] = useState(props.initialItems[props.initialPosition].draftAnswer ?? "");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [blankWarning, setBlankWarning] = useState<number | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const currentItem = items[position];
  const loaded = cache.get(currentItem.id);

  async function goToPosition(nextPosition: number) {
    if (nextPosition === position) return;
    setPosition(nextPosition);
    setDraft(items[nextPosition].draftAnswer ?? "");
    setBlankWarning(null);
    setCompleteError(null);
    const nextItem = items[nextPosition];
    if (!cache.has(nextItem.id)) {
      setLoading(true);
      const question = await props.loadQuestion(nextItem.id);
      setCache((prev) => new Map(prev).set(nextItem.id, question));
      setLoading(false);
    }
    void props.savePosition(nextPosition);
  }

  function updateDraft(value: string) {
    setDraft(value);
    setItems((prev) => prev.map((it) => (it.id === currentItem.id ? { ...it, draftAnswer: value, skipped: false } : it)));
    void props.saveDraft(currentItem.id, { draftAnswer: value, skipped: false });
  }

  async function handleSkip() {
    setItems((prev) => prev.map((it) => (it.id === currentItem.id ? { ...it, skipped: true } : it)));
    await props.saveDraft(currentItem.id, { skipped: true });
    if (position < items.length - 1) await goToPosition(position + 1);
  }

  async function handleSubmit() {
    if (!draft) return;
    setSubmitting(true);
    const result = await props.submitAnswer(currentItem.id, draft);
    setItems((prev) =>
      prev.map((it) =>
        it.id === currentItem.id
          ? { ...it, submitted: true, studentAnswer: result.studentAnswer, isCorrect: result.isCorrect, skipped: false }
          : it,
      ),
    );
    setCache((prev) => new Map(prev).set(currentItem.id, { content: loaded!.content, feedback: result.feedback }));
    setSubmitting(false);
  }

  async function handleFinish(confirmBlanks: boolean) {
    setCompleting(true);
    setCompleteError(null);
    const result = await props.complete({ confirmBlanks });
    if (result.ok) {
      router.push(result.redirectTo);
      return;
    }
    setCompleting(false);
    if (props.allowBlankConfirmation) {
      setBlankWarning(result.unansweredCount);
    } else {
      setCompleteError(`${result.unansweredCount} question${result.unansweredCount === 1 ? "" : "s"} remain unanswered.`);
      const firstUnanswered = items.find((it) => !it.submitted);
      if (firstUnanswered) await goToPosition(firstUnanswered.position);
    }
  }

  const navItems = items.map((it) => ({
    position: it.position,
    state: (it.position === position ? "current" : it.submitted ? "submitted" : it.skipped ? "skipped" : "unanswered") as NavItemState,
  }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 sm:p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{props.title}</h1>
        <span className="text-sm text-muted-foreground">
          Question {position + 1} of {items.length}
        </span>
      </div>

      <SessionNavGrid items={navItems} onSelect={(p) => void goToPosition(p)} />

      {completeError && (
        <Alert variant="destructive">
          <AlertDescription>{completeError}</AlertDescription>
        </Alert>
      )}

      {loading || !loaded ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">Loading question…</div>
      ) : (
        <div className="rounded-lg border border-border p-4 sm:p-6">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{CALCULATOR_LABELS[loaded.content.calculatorSetting]}</span>
            <TimerBadge suggestedTimeSeconds={loaded.content.suggestedTimeSeconds} resetKey={currentItem.id} />
          </div>

          <LatexText text={loaded.content.questionText} className="text-base" />

          {loaded.content.questionImageId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/media/${loaded.content.questionImageId}`} alt="" className="mt-3 max-w-full rounded" />
          )}

          {loaded.content.calculatorSetting === "ALLOWED" && (
            <div className="mt-4">
              <Calculator />
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2">
            {loaded.content.questionType === "MULTIPLE_CHOICE" ? (
              loaded.content.answerChoices.map((choice) => {
                const isSelected = draft === choice.id;
                const showCorrect = currentItem.submitted && loaded.feedback?.correctChoiceId === choice.id;
                const showWrongSelection = currentItem.submitted && isSelected && loaded.feedback?.correctChoiceId !== choice.id;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    disabled={currentItem.submitted}
                    onClick={() => updateDraft(choice.id)}
                    aria-pressed={isSelected}
                    className={[
                      "rounded-md border p-3 text-left text-sm transition-colors",
                      isSelected && !currentItem.submitted && "border-primary bg-primary/5",
                      !isSelected && !showCorrect && !showWrongSelection && "border-border",
                      showCorrect && "border-2 border-green-600 bg-green-100 dark:border-green-500 dark:bg-green-900/50",
                      showWrongSelection && "border-destructive bg-destructive/5",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <LatexText text={choice.text} />
                    {choice.imageId && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/media/${choice.imageId}`} alt="" className="mt-2 max-w-full rounded" />
                    )}
                  </button>
                );
              })
            ) : (
              <input
                type="text"
                value={draft}
                onChange={(e) => updateDraft(e.target.value)}
                disabled={currentItem.submitted}
                placeholder="Enter your answer"
                aria-label="Your answer"
                className="rounded-md border border-border p-2 text-sm disabled:bg-muted"
              />
            )}
          </div>

          {!currentItem.submitted ? (
            <div className="mt-4 flex gap-2">
              <Button onClick={handleSubmit} disabled={!draft || submitting}>
                {submitting ? "Submitting…" : "Submit answer"}
              </Button>
              <Button variant="outline" onClick={handleSkip} disabled={submitting}>
                Skip for now
              </Button>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              <p className={`text-sm font-medium ${currentItem.isCorrect ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>
                {currentItem.isCorrect ? "Correct!" : "Incorrect."}
              </p>
              {loaded.content.questionType === "OPEN_ENDED_NUMERIC" && loaded.feedback && (
                <p className="text-sm text-muted-foreground">Accepted answer: {loaded.feedback.acceptedAnswers[0]}</p>
              )}
              {loaded.feedback?.writtenExplanation && (
                <div className="rounded-md bg-muted p-3 text-sm">
                  <LatexText text={loaded.feedback.writtenExplanation} />
                </div>
              )}
              {loaded.feedback?.explanationVideoId && (
                <video controls className="w-full rounded" src={`/api/media/${loaded.feedback.explanationVideoId}`} />
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <div className="flex gap-2">
          <Button variant="ghost" disabled={position === 0} onClick={() => void goToPosition(position - 1)}>
            Previous
          </Button>
          <Button variant="ghost" disabled={position === items.length - 1} onClick={() => void goToPosition(position + 1)}>
            Next
          </Button>
        </div>
        <Button onClick={() => void handleFinish(false)} disabled={completing}>
          {completing ? "Finishing…" : `Finish ${props.title}`}
        </Button>
      </div>

      {blankWarning !== null && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4" role="alertdialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-lg bg-card p-5 shadow-lg">
            <p className="mb-2 font-medium">
              {blankWarning} question{blankWarning === 1 ? "" : "s"} unanswered
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              Unanswered questions will be counted as incorrect. You can go back and answer them, or submit anyway.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setBlankWarning(null)}>
                Go back
              </Button>
              <Button onClick={() => void handleFinish(true)} disabled={completing}>
                {completing ? "Submitting…" : "Submit anyway"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
