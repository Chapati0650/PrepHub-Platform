"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { LatexText } from "@/components/content/latex-text";
import { QuestionStatement } from "@/components/content/question-statement";
import { Calculator } from "@/components/session/calculator";
import type { StudentQuestionContent } from "@/lib/session/question-content";

/**
 * The question itself, shared by the recorded runner and the live room so a
 * rush question looks the same whichever way it's played.
 *
 * Two changes on 2026-10-24, both reported by the Owner:
 *
 * **The passage is shown.** Reading & Writing questions store their text in
 * `passageText`, separately from the question (that split is what drives the
 * two-pane layout in the Diagnostic and Practice). This component only ever
 * rendered `questionText`, so every Reading question in a rush showed the
 * stem — "Which choice best states the main idea of the text?" — with no text
 * to answer it from. On a wide screen the passage now sits beside the
 * question, as it does in the test runner; on a phone it stacks above.
 *
 * **Choosing no longer submits.** A tap used to lock an answer in, which made
 * comparing two choices impossible without committing to one. A choice is now
 * a draft until Submit — and to keep a race a race, the keyboard does it in
 * two keystrokes: A–D (or 1–4) to pick, Enter to submit. When the clock runs
 * out, the runner submits whatever is selected (see `draft` in the runners).
 */
export function RushQuestion({
  content,
  draft,
  answered,
  correctChoiceId,
  onDraftChange,
  onAnswer,
  feedback,
}: {
  content: StudentQuestionContent;
  draft: string;
  answered: boolean;
  correctChoiceId: string | null;
  onDraftChange: (value: string) => void;
  onAnswer: (answer: string) => void;
  /** Set for one answer's worth of time: drives the right/wrong flash. */
  feedback?: "correct" | "wrong" | null;
}) {
  const isChoice = content.questionType === "MULTIPLE_CHOICE";
  const hasPassage = (content.passageText ?? "").trim().length > 0;

  // The latest values for the key handler, without re-binding it on every
  // keystroke. Refreshed in an effect, never written during render.
  const live = useRef({ draft, answered, onAnswer, onDraftChange, content });
  useEffect(() => {
    live.current = { draft, answered, onAnswer, onDraftChange, content };
  });

  useEffect(() => {
    if (!isChoice) return;
    function onKey(e: KeyboardEvent) {
      const { draft: d, answered: done, onAnswer: submit, onDraftChange: choose, content: c } = live.current;
      if (done || e.metaKey || e.ctrlKey || e.altKey) return;
      // Never steal keys from a field — the calculator has inputs of its own.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;

      if (e.key === "Enter") {
        if (d) {
          e.preventDefault();
          submit(d);
        }
        return;
      }
      const letter = "abcd".indexOf(e.key.toLowerCase());
      const digit = "1234".indexOf(e.key);
      const index = letter !== -1 ? letter : digit;
      if (index !== -1 && c.answerChoices[index]) {
        e.preventDefault();
        choose(c.answerChoices[index].id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isChoice]);

  const question = (
    <div>
      <QuestionStatement
        text={content.questionText}
        imageId={content.questionImageId}
        mediaBasePath="/api/media"
        className="bg-transparent p-0"
        textClassName="text-lg leading-relaxed lg:text-xl lg:leading-relaxed"
      />

      {content.calculatorSetting === "ALLOWED" && (
        <div className="mt-4">
          <Calculator />
        </div>
      )}

      <div className="mt-6 flex flex-col gap-2.5">
        {isChoice ? (
          content.answerChoices.map((choice, choiceIndex) => {
            const letter = String.fromCharCode(65 + choiceIndex);
            const isSelected = draft === choice.id;
            const showCorrect = answered && correctChoiceId === choice.id;
            const showWrongSelection = answered && isSelected && correctChoiceId !== choice.id;
            return (
              <button
                key={choice.id}
                type="button"
                disabled={answered}
                onClick={() => onDraftChange(choice.id)}
                aria-pressed={isSelected}
                data-answer-choice={letter}
                className={[
                  "flex items-start gap-4 rounded-xl border-2 p-4 text-left text-base transition-colors lg:text-lg",
                  isSelected && !answered && "border-primary bg-primary/10",
                  !isSelected && !showCorrect && !showWrongSelection && "border-border hover:border-foreground/30",
                  showCorrect && "border-green-600 bg-green-100 dark:border-green-500 dark:bg-green-900/50",
                  showWrongSelection && "border-destructive bg-destructive/5",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span
                  aria-hidden
                  className={[
                    "mt-px flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold lg:size-8",
                    isSelected && !answered ? "border-primary bg-primary text-primary-foreground" : "border-foreground/30 text-foreground",
                  ].join(" ")}
                >
                  {letter}
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
          <form
            className="flex flex-wrap items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) onAnswer(draft.trim());
            }}
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              disabled={answered}
              placeholder="Enter your answer"
              aria-label="Your answer"
              autoFocus
              className="max-w-xs rounded-xl border-2 border-border p-3 text-base disabled:bg-muted lg:text-lg"
            />
            {!answered && (
              <Button type="submit" size="cta" disabled={!draft.trim()}>
                Submit
              </Button>
            )}
          </form>
        )}
      </div>

      {isChoice && !answered && (
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button size="cta" onClick={() => draft && onAnswer(draft)} disabled={!draft}>
            Submit
          </Button>
          {/* Keyboard play is the fast way, so it's said once, quietly. */}
          <p className="hidden text-sm text-muted-foreground sm:block">
            Press <kbd className="rounded border border-border px-1.5 py-0.5 font-sans text-xs">A</kbd>–
            <kbd className="rounded border border-border px-1.5 py-0.5 font-sans text-xs">D</kbd> to pick,{" "}
            <kbd className="rounded border border-border px-1.5 py-0.5 font-sans text-xs">Enter</kbd> to submit.
          </p>
        </div>
      )}
    </div>
  );

  // The flash is the card's outline, so it reads at a glance without covering
  // the answer being revealed. Colour is never the only signal: the runner
  // also prints Correct! or Incorrect. and the points.
  // Offset so the ring sits clear of the content rather than on its edge,
  // where it clipped the first line of the passage and the stem.
  const flash =
    feedback === "correct"
      ? "ring-4 ring-green-500/50 ring-offset-8 ring-offset-background"
      : feedback === "wrong"
        ? "ring-4 ring-destructive/40 ring-offset-8 ring-offset-background motion-safe:animate-rush-shake"
        : "ring-0";

  return (
    <div className={`rounded-2xl transition-shadow duration-300 ${flash}`}>
      {hasPassage ? (
        <div className="grid gap-6 md:grid-cols-2 md:gap-10">
          <QuestionStatement
            text={content.passageText ?? ""}
            imageId={null}
            mediaBasePath="/api/media"
            className="bg-transparent p-0 md:border-r md:border-foreground/15 md:pr-10"
            textClassName="text-lg leading-relaxed lg:text-xl lg:leading-relaxed"
          />
          {question}
        </div>
      ) : (
        question
      )}
    </div>
  );
}

export function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(1).replace(/\.0$/, "");
}

/**
 * The clock. A bar, not a ticking number, as the primary cue: readable from
 * the corner of the eye while the question has the focus. The seconds are
 * still there for anyone who wants them. In the last quarter it turns amber,
 * in the last tenth red and pulsing.
 */
export function TimeBar({
  remainingMs,
  limitMs,
  frozen,
  right,
}: {
  remainingMs: number;
  limitMs: number;
  frozen: boolean;
  right?: React.ReactNode;
}) {
  const fraction = Math.max(0, Math.min(1, remainingMs / limitMs));
  const urgent = !frozen && fraction < 0.25;
  const critical = !frozen && fraction < 0.1;
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-foreground/10" aria-hidden>
        <div
          className={[
            "h-full rounded-full transition-[width] duration-100 ease-linear",
            critical ? "bg-destructive motion-safe:animate-rush-pulse" : urgent ? "bg-amber-500" : "bg-primary",
          ].join(" ")}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs tabular-nums text-muted-foreground">
        <span aria-live="off" className={critical ? "font-semibold text-destructive" : undefined}>
          {Math.ceil(remainingMs / 1000)}s left
        </span>
        {right}
      </div>
    </div>
  );
}
