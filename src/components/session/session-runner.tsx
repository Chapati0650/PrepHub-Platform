"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LatexText } from "@/components/content/latex-text";
import { QuestionStatement } from "@/components/content/question-statement";
import { ExplanationSteps } from "@/components/content/explanation-steps";
import { DistractorNote } from "@/components/content/distractor-note";
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

// studentAnswer is optional: the live runner already tracks it separately in
// its own `items` state (see SessionRunnerItem), so its own loadQuestion
// calls never populate this — only the results-review "detail" loaders do,
// for QuestionDetail below to look up the right distractor note.
export type LoadedQuestion = {
  content: StudentQuestionContent;
  feedback: StudentQuestionFeedback | null;
  studentAnswer?: string | null;
};

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

  // A multiple-choice tap submits directly (the way the SAT's own Bluebook
  // does not, but the way every student expects a phone to): choose →
  // feedback → Next is two taps per question instead of three. Numeric
  // answers keep an explicit Submit, since typing has no natural "done".
  async function handleSubmit(answer: string = draft) {
    if (!answer || submitting) return;
    setSubmitting(true);
    const result = await props.submitAnswer(currentItem.id, answer);
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

  const unansweredCount = items.filter((it) => !it.submitted).length;
  const firstUnanswered = items.find((it) => !it.submitted) ?? null;

  const navItems = items.map((it) => ({
    position: it.position,
    state: (it.position === position ? "current" : it.submitted ? "submitted" : it.skipped ? "skipped" : "unanswered") as NavItemState,
  }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4 pb-16 sm:p-8">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">{props.title}</h1>
        <span className="text-sm tabular-nums text-muted-foreground">
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
        <div className="py-16 text-sm text-muted-foreground">Loading question…</div>
      ) : (
        /* No card border. The session runner is the app shell's focus mode —
           there is nothing else on screen for a frame to separate the question
           from, so the outline was chrome around the whole viewport. The rule
           under the meta row does the one real job the border had: marking
           where the question itself starts. */
        <div>
          <div className="mb-5 flex items-center justify-between gap-4 border-b border-border pb-3">
            <span className="text-xs text-muted-foreground">{CALCULATOR_LABELS[loaded.content.calculatorSetting]}</span>
            <TimerBadge suggestedTimeSeconds={loaded.content.suggestedTimeSeconds} resetKey={currentItem.id} />
          </div>

          {/* PRD-006/Brilliant reference: question text stays "large, comfortable"
              even as the app's base font-size tightened for density elsewhere
              (globals.css) — this is the one place that should read generously,
              not compactly. */}
          <QuestionStatement
            text={loaded.content.questionText}
            imageId={loaded.content.questionImageId}
            mediaBasePath="/api/media"
            textClassName="text-lg leading-relaxed"
          />

          {loaded.content.calculatorSetting === "ALLOWED" && (
            <div className="mt-4">
              <Calculator />
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2.5">
            {loaded.content.questionType === "MULTIPLE_CHOICE" ? (
              loaded.content.answerChoices.map((choice, choiceIndex) => {
                const isSelected = draft === choice.id;
                const showCorrect = currentItem.submitted && loaded.feedback?.correctChoiceId === choice.id;
                const showWrongSelection = currentItem.submitted && isSelected && loaded.feedback?.correctChoiceId !== choice.id;
                return (
                  <button
                    key={choice.id}
                    type="button"
                    disabled={currentItem.submitted || submitting}
                    onClick={() => {
                      updateDraft(choice.id);
                      void handleSubmit(choice.id);
                    }}
                    aria-pressed={isSelected}
                    className={[
                      "flex items-start gap-4 rounded-xl border p-4 text-left text-base transition-colors",
                      isSelected && !currentItem.submitted && "border-primary bg-primary/5",
                      !isSelected && !showCorrect && !showWrongSelection && "border-border hover:border-foreground/25",
                      showCorrect && "border-2 border-green-600 bg-green-100 dark:border-green-500 dark:bg-green-900/50",
                      showWrongSelection && "border-destructive bg-destructive/5",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {/* A/B/C/D, the way the choice is labelled on the real
                        test and in Bluebook. Purely presentational (the button
                        itself still carries the selection state), but it is
                        what makes four bordered rows read as an SAT question
                        rather than a generic list of options. */}
                    <span
                      aria-hidden
                      className={[
                        "mt-px flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
                        isSelected && !currentItem.submitted
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-foreground/20 text-muted-foreground",
                      ].join(" ")}
                    >
                      {String.fromCharCode(65 + choiceIndex)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <LatexText text={choice.text} />
                      {choice.imageId && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/media/${choice.imageId}`} alt="" className="mt-2 max-w-full rounded" />
                      )}
                    </span>
                  </button>
                );
              })
            ) : (
              <input
                type="text"
                value={draft}
                onChange={(e) => updateDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSubmit();
                }}
                disabled={currentItem.submitted}
                placeholder="Enter your answer"
                aria-label="Your answer"
                className="max-w-xs rounded-xl border border-border p-3 text-base disabled:bg-muted"
              />
            )}
          </div>

          {!currentItem.submitted ? (
            <div className="mt-6 flex flex-wrap gap-3">
              {loaded.content.questionType === "OPEN_ENDED_NUMERIC" && (
                <Button size="cta" onClick={() => void handleSubmit()} disabled={!draft || submitting}>
                  {submitting ? "Submitting…" : "Submit answer"}
                </Button>
              )}
              <Button size="cta" variant="ghost" onClick={handleSkip} disabled={submitting}>
                Skip for now
              </Button>
            </div>
          ) : (
            <div className="mt-6 flex flex-col gap-3">
              <p className={`font-heading text-lg font-semibold ${currentItem.isCorrect ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>
                {currentItem.isCorrect ? "Correct!" : "Incorrect."}
              </p>
              {loaded.content.questionType === "OPEN_ENDED_NUMERIC" && loaded.feedback && (
                <p className="text-sm text-muted-foreground">Accepted answer: {loaded.feedback.acceptedAnswers[0]}</p>
              )}
              {!currentItem.isCorrect &&
                currentItem.studentAnswer &&
                loaded.feedback?.distractorExplanationsByChoiceId[currentItem.studentAnswer] && (
                  <DistractorNote text={loaded.feedback.distractorExplanationsByChoiceId[currentItem.studentAnswer]} />
                )}
              {loaded.feedback && loaded.feedback.explanationSteps.length > 0 ? (
                <ExplanationSteps steps={loaded.feedback.explanationSteps} mediaBasePath="/api/media" />
              ) : (
                loaded.feedback?.writtenExplanation && (
                  <div className="rounded-md bg-muted p-3 text-sm">
                    <LatexText text={loaded.feedback.writtenExplanation} />
                  </div>
                )
              )}
              {loaded.feedback?.explanationVideoId && (
                <video controls className="w-full rounded" src={`/api/media/${loaded.feedback.explanationVideoId}`} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Finish appears only once every question is answered — shown from
          question 1 it read as an exit, and a set can't be finished with
          blanks anyway (PRD-005 §21). On the last question with blanks
          left, the button instead jumps to the first one. */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        <div className="flex gap-1">
          <Button variant="ghost" disabled={position === 0} onClick={() => void goToPosition(position - 1)}>
            Previous
          </Button>
          <Button variant="ghost" disabled={position === items.length - 1} onClick={() => void goToPosition(position + 1)}>
            Next
          </Button>
        </div>
        {unansweredCount === 0 ? (
          <Button size="cta" onClick={() => void handleFinish(false)} disabled={completing}>
            {completing ? "Finishing…" : `Finish ${props.title}`}
          </Button>
        ) : position === items.length - 1 ? (
          <Button variant="outline" className="rounded-full" onClick={() => void goToPosition(firstUnanswered!.position)}>
            {unansweredCount} left · go to question {firstUnanswered!.position + 1}
          </Button>
        ) : (
          <span className="text-sm tabular-nums text-muted-foreground">{unansweredCount} left</span>
        )}
      </div>

      {blankWarning !== null && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4" role="alertdialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg">
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
