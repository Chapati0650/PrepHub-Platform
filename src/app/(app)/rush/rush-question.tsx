"use client";

import { Button } from "@/components/ui/button";
import { LatexText } from "@/components/content/latex-text";
import { QuestionStatement } from "@/components/content/question-statement";
import { Calculator } from "@/components/session/calculator";
import type { StudentQuestionContent } from "@/lib/session/question-content";

// The question itself, shared by the recorded runner and the live room so
// a rush question looks the same whichever way it's played. Choosing a
// multiple-choice answer submits at once — a rush has no separate Submit
// step — and the numeric form submits on Enter or its button.
export function RushQuestion({
  content,
  draft,
  answered,
  correctChoiceId,
  onDraftChange,
  onAnswer,
}: {
  content: StudentQuestionContent;
  draft: string;
  answered: boolean;
  correctChoiceId: string | null;
  onDraftChange: (value: string) => void;
  onAnswer: (answer: string) => void;
}) {
  return (
    <div>
      <QuestionStatement text={content.questionText} imageId={content.questionImageId} mediaBasePath="/api/media" textClassName="text-lg leading-relaxed" />

      {content.calculatorSetting === "ALLOWED" && (
        <div className="mt-4">
          <Calculator />
        </div>
      )}

      <div className="mt-6 flex flex-col gap-2.5">
        {content.questionType === "MULTIPLE_CHOICE" ? (
          content.answerChoices.map((choice, choiceIndex) => {
            const isSelected = draft === choice.id;
            const showCorrect = answered && correctChoiceId === choice.id;
            const showWrongSelection = answered && isSelected && correctChoiceId !== choice.id;
            return (
              <button
                key={choice.id}
                type="button"
                disabled={answered}
                onClick={() => {
                  onDraftChange(choice.id);
                  onAnswer(choice.id);
                }}
                aria-pressed={isSelected}
                className={[
                  "flex items-start gap-4 rounded-xl border p-4 text-left text-base transition-colors",
                  isSelected && !answered && "border-primary bg-primary/5",
                  !isSelected && !showCorrect && !showWrongSelection && "border-border hover:border-foreground/25",
                  showCorrect && "border-2 border-green-600 bg-green-100 dark:border-green-500 dark:bg-green-900/50",
                  showWrongSelection && "border-destructive bg-destructive/5",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span
                  aria-hidden
                  className={[
                    "mt-px flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
                    isSelected && !answered ? "border-primary bg-primary text-primary-foreground" : "border-foreground/20 text-muted-foreground",
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
              className="max-w-xs rounded-xl border border-border p-3 text-base disabled:bg-muted"
            />
            {!answered && (
              <Button type="submit" size="cta" disabled={!draft.trim()}>
                Submit
              </Button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

export function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(1).replace(/\.0$/, "");
}

// The clock. A bar, not a ticking number, as the primary cue: readable from
// the corner of the eye while the question has the focus. The seconds are
// still there for anyone who wants them.
export function TimeBar({ remainingMs, limitMs, frozen, right }: { remainingMs: number; limitMs: number; frozen: boolean; right?: React.ReactNode }) {
  const fraction = Math.max(0, Math.min(1, remainingMs / limitMs));
  const urgent = !frozen && fraction < 0.25;
  const critical = !frozen && fraction < 0.1;
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10" aria-hidden>
        <div
          className={["h-full rounded-full transition-[width] duration-100 ease-linear", critical ? "bg-destructive" : urgent ? "bg-amber-500" : "bg-primary"].join(" ")}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 text-xs tabular-nums text-muted-foreground">
        <span aria-live="off" className={critical ? "font-medium text-destructive" : undefined}>
          {Math.ceil(remainingMs / 1000)}s left
        </span>
        {right}
      </div>
    </div>
  );
}
