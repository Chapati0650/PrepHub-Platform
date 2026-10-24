"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, ChevronUp, Calculator as CalcIcon } from "lucide-react";
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
import { SplitPane } from "./split-pane";

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
  /** What the footer pill calls each item: "Question 3 of 14", "Bonus question 1 of 4". */
  itemLabel?: string;
  /** The final button. "Finish" unless the next step isn't actually the end. */
  finishLabel?: string;
  /** Shown bottom-left, where Bluebook prints the test taker's name. */
  studentName?: string;
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

  // Bluebook's test-taking aids. Elimination, the timer toggle and the
  // navigator are view state only and reset on reload, which matches how
  // little they cost to re-apply. "Mark for Review" is deliberately *not*
  // new state: it maps onto the existing persisted `skipped` flag, which
  // already survives a reload and already has its own colour in the
  // question navigator.
  const [navOpen, setNavOpen] = useState(false);
  const [timerHidden, setTimerHidden] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [eliminated, setEliminated] = useState<Map<string, Set<string>>>(new Map());

  const currentItem = items[position];
  const loaded = cache.get(currentItem.id);

  function toggleEliminated(choiceId: string) {
    setEliminated((prev) => {
      const next = new Map(prev);
      const forItem = new Set(next.get(currentItem.id) ?? []);
      if (forItem.has(choiceId)) forItem.delete(choiceId);
      else forItem.add(choiceId);
      next.set(currentItem.id, forItem);
      return next;
    });
  }

  // Bluebook's Mark for Review does not advance to the next question;
  // handleSkip does. Same persisted flag, different gesture.
  function toggleMarked() {
    const next = !currentItem.skipped;
    setItems((prev) => prev.map((it) => (it.id === currentItem.id ? { ...it, skipped: next } : it)));
    void props.saveDraft(currentItem.id, { skipped: next });
  }

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

  const marked = currentItem.skipped;
  const eliminatedHere = eliminated.get(currentItem.id) ?? new Set<string>();

  // Truthiness, not `!== null`: a stale client or an older payload makes this
  // undefined, and `undefined !== null` is true, which split the screen and
  // left an empty pane beside every maths question. An all-whitespace passage
  // saved from the editor would do the same.
  const hasPassage = (loaded?.content.passageText ?? "").trim().length > 0;

  // Width follows the content, the way Bluebook's two module types do. A
  // passage question splits the whole window in half — passage left, question
  // right — so each side gets a real reading column. A single-column question
  // (maths, or a stem with no passage) stays a centred column, because one
  // line of text stretched across a wide monitor is harder to read, not
  // easier. The column used to be max-w-3xl for both, which on a wide monitor
  // left a passage and its question sharing a third of the screen at roughly
  // 350px each, with the rest empty.
  const columnWidth = hasPassage ? "max-w-screen-2xl" : "max-w-4xl";

  return (
    // Laid out like Bluebook: a band at the top carrying the section label,
    // the clock and the tools, the question in the middle, and a band at the
    // bottom carrying the name, the navigator and Back/Next. The dashed
    // rules are Bluebook's too, and they are most of why this reads as the
    // real thing rather than a generic quiz.
    //
    // Brand colour is kept for the controls rather than Bluebook's blue. The
    // shape is what creates the familiarity; repainting the product another
    // organisation's blue is a separate decision and not one this makes.
    <div className="flex flex-1 flex-col bg-background">
      <header className="border-b border-dashed border-foreground/40 px-4 py-3 sm:px-8">
        <div className="mx-auto grid w-full max-w-screen-2xl grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="min-w-0">
            <p className="truncate font-heading text-sm font-semibold tracking-tight sm:text-base">{props.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {loaded ? CALCULATOR_LABELS[loaded.content.calculatorSetting] : " "}
            </p>
          </div>

          <div className="flex flex-col items-center">
            {loaded && !timerHidden && (
              <TimerBadge suggestedTimeSeconds={loaded.content.suggestedTimeSeconds} resetKey={currentItem.id} />
            )}
            <button
              type="button"
              onClick={() => setTimerHidden((v) => !v)}
              className="mt-1 rounded-full border border-border px-3 py-0.5 text-xs font-medium hover:bg-muted"
            >
              {timerHidden ? "Show" : "Hide"}
            </button>
          </div>

          <div className="flex items-center justify-end gap-4">
            {loaded?.content.calculatorSetting === "ALLOWED" && (
              <button
                type="button"
                onClick={() => setCalculatorOpen((v) => !v)}
                aria-pressed={calculatorOpen}
                className="flex flex-col items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <CalcIcon className="size-5" aria-hidden />
                Calculator
              </button>
            )}
          </div>
        </div>
      </header>

      <main className={`mx-auto w-full ${columnWidth} flex-1 px-4 py-6 sm:px-8`}>
        {completeError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{completeError}</AlertDescription>
          </Alert>
        )}

        {loading || !loaded ? (
          <div className="py-16 text-sm text-muted-foreground">Loading question…</div>
        ) : (
          <>
            {/* Bluebook's question strip: a filled number badge, Mark for
                Review, and the answer-elimination toggle on the right. */}
            <div className="flex items-center justify-between gap-3 border-b-2 border-dashed border-foreground/40 bg-muted/70 px-3 py-1.5">
              <div className="flex items-center gap-3">
                <span className="flex size-7 items-center justify-center bg-foreground font-heading text-sm font-bold text-background">
                  {position + 1}
                </span>
                <button
                  type="button"
                  onClick={toggleMarked}
                  aria-pressed={marked}
                  className="flex items-center gap-1.5 text-sm hover:underline"
                >
                  <Bookmark className={marked ? "size-4 fill-current" : "size-4"} aria-hidden />
                  Mark for Review
                </button>
              </div>
            </div>

            <div className="pt-5">
              <SplitPane
                hasPassage={hasPassage}
                left={
                  <QuestionStatement
                    text={loaded.content.passageText ?? ""}
                    imageId={null}
                    mediaBasePath="/api/media"
                    className="bg-transparent p-0"
                    textClassName="text-lg leading-relaxed lg:text-xl lg:leading-relaxed"
                  />
                }
              >
              {/* No tinted panel behind the stem. Bluebook sets the question
                  as plain text on the page, and the box made every question
                  look like a callout rather than the thing being asked. */}
              <QuestionStatement
                text={loaded.content.questionText}
                imageId={loaded.content.questionImageId}
                mediaBasePath="/api/media"
                className="bg-transparent p-0"
                textClassName="text-lg leading-relaxed lg:text-xl lg:leading-relaxed"
              />

              {calculatorOpen && loaded.content.calculatorSetting === "ALLOWED" && (
                <div className="mt-4">
                  <Calculator defaultOpen />
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3">
                {loaded.content.questionType === "MULTIPLE_CHOICE" ? (
                  loaded.content.answerChoices.map((choice, choiceIndex) => {
                    const letter = String.fromCharCode(65 + choiceIndex);
                    const isSelected = draft === choice.id;
                    const showCorrect = currentItem.submitted && loaded.feedback?.correctChoiceId === choice.id;
                    const showWrongSelection =
                      currentItem.submitted && isSelected && loaded.feedback?.correctChoiceId !== choice.id;
                    const isOut = eliminatedHere.has(choice.id) && !currentItem.submitted;
                    return (
                      <div key={choice.id} className="flex items-center gap-3">
                        <button
                          type="button"
                          disabled={currentItem.submitted || submitting}
                          onClick={() => {
                            if (isOut) return;
                            updateDraft(choice.id);
                          }}
                          aria-pressed={isSelected}
                          // A content-agnostic hook for the e2e suite. The
                          // accessible name is the choice's own text (the
                          // letter is aria-hidden), and `aria-pressed` alone
                          // also matches Mark for Review and the cross-outs.
                          data-answer-choice={letter}
                          className={[
                            "flex flex-1 items-center gap-4 rounded-lg border-2 px-4 py-3 text-left text-base transition-colors lg:px-5 lg:py-4 lg:text-lg",
                            isSelected && !currentItem.submitted && "border-primary bg-primary/10",
                            !isSelected && !showCorrect && !showWrongSelection && "border-border hover:border-foreground/40",
                            showCorrect && "border-green-600 bg-green-100 dark:border-green-500 dark:bg-green-900/50",
                            showWrongSelection && "border-destructive bg-destructive/5",
                            isOut && "opacity-45",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <span
                            aria-hidden
                            className={[
                              "flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold lg:size-8 lg:text-base",
                              isSelected && !currentItem.submitted
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-foreground/40 text-foreground",
                            ].join(" ")}
                          >
                            {letter}
                          </span>
                          <span className={["min-w-0 flex-1", isOut && "line-through"].filter(Boolean).join(" ")}>
                            <LatexText text={choice.text} />
                            {choice.imageId && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={`/api/media/${choice.imageId}`} alt="" className="mt-2 max-w-full rounded" />
                            )}
                          </span>
                        </button>

                        {/* Bluebook puts the cross-out control outside the
                            choice, so ruling an answer out can never be
                            mistaken for selecting it. */}
                        {!currentItem.submitted && (
                          <button
                            type="button"
                            onClick={() => toggleEliminated(choice.id)}
                            aria-pressed={isOut}
                            aria-label={isOut ? `Restore answer ${letter}` : `Cross out answer ${letter}`}
                            className="flex size-7 shrink-0 items-center justify-center rounded-full border border-foreground/40 text-xs font-semibold line-through hover:bg-muted lg:size-8 lg:text-sm"
                          >
                            {letter}
                          </button>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div>
                    <input
                      type="text"
                      value={draft}
                      onChange={(e) => updateDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleSubmit();
                      }}
                      disabled={currentItem.submitted}
                      aria-label="Your answer"
                      className="w-44 rounded-lg border-2 border-foreground/40 px-3 py-2 text-lg disabled:bg-muted"
                    />
                    {/* Bluebook echoes what has been typed under the box, so a
                        student can check a fraction or a decimal before moving on. */}
                    <p className="mt-4 font-heading text-lg font-semibold">
                      Answer Preview <span className="font-normal text-muted-foreground">{draft || "—"}</span>
                    </p>
                  </div>
                )}
              </div>

              {!currentItem.submitted ? (
                // Selecting no longer grades. A tap used to submit on the
                // spot, which made trying a choice indistinguishable from
                // committing to one — a student comparing options had
                // already been marked wrong. Both question types now take an
                // explicit Submit, and until then the choice is only a saved
                // draft.
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button size="cta" onClick={() => void handleSubmit()} disabled={!draft || submitting}>
                    {submitting ? "Submitting…" : "Submit answer"}
                  </Button>
                  <Button size="cta" variant="ghost" onClick={handleSkip} disabled={submitting}>
                    Skip for now
                  </Button>
                </div>
              ) : (
                <div className="mt-6 flex flex-col gap-3">
                  <p
                    className={`font-heading text-lg font-semibold ${currentItem.isCorrect ? "text-green-700 dark:text-green-400" : "text-destructive"}`}
                  >
                    {currentItem.isCorrect ? "Correct!" : "Incorrect."}
                  </p>
                  {loaded.content.questionType === "OPEN_ENDED_NUMERIC" && loaded.feedback && (
                    <p className="text-sm text-muted-foreground">Accepted answer {loaded.feedback.acceptedAnswers[0]}</p>
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
              </SplitPane>
            </div>
          </>
        )}
      </main>

      {/* The navigator lives behind the footer pill the way Bluebook's does,
          rather than sitting above every question taking the top third of a
          phone screen. */}
      {navOpen && (
        <div className={`mx-auto w-full ${columnWidth} px-4 pb-3 sm:px-8`}>
          <div className="rounded-xl border border-border bg-card p-4 shadow-lg">
            <SessionNavGrid
              items={navItems}
              onSelect={(p) => {
                setNavOpen(false);
                void goToPosition(p);
              }}
            />
          </div>
        </div>
      )}

      {/* Pinned, like Bluebook's: the question pill and Back/Next are how a
          student moves through the test, and they used to sit below the fold
          on a laptop — the runner was min-h-screen beneath the focus bar, so it
          always overflowed by at least that bar's height. */}
      <footer className="sticky bottom-0 z-10 border-t border-dashed border-foreground/40 bg-background px-4 py-3 sm:px-8">
        <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between gap-3">
          <span className="hidden min-w-0 flex-1 truncate font-heading font-semibold sm:block">
            {props.studentName ?? ""}
          </span>

          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            aria-expanded={navOpen}
            className="flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background"
          >
            {props.itemLabel ?? "Question"} {position + 1} of {items.length}
            <ChevronUp
              className={navOpen ? "size-4 rotate-180 transition-transform" : "size-4 transition-transform"}
              aria-hidden
            />
          </button>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              disabled={position === 0}
              onClick={() => void goToPosition(position - 1)}
            >
              Back
            </Button>
            {unansweredCount === 0 ? (
              <Button className="rounded-full" onClick={() => void handleFinish(false)} disabled={completing}>
                {completing ? "One moment…" : (props.finishLabel ?? "Finish")}
              </Button>
            ) : position === items.length - 1 ? (
              <Button className="rounded-full" onClick={() => void goToPosition(firstUnanswered!.position)}>
                {unansweredCount} left
              </Button>
            ) : (
              <Button className="rounded-full" onClick={() => void goToPosition(position + 1)}>
                Next
              </Button>
            )}
          </div>
        </div>
      </footer>

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
