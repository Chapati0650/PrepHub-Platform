"use client";

import { LinkButton } from "@/components/ui/link-button";
import { Badge } from "@/components/ui/badge";
import { ReviewDetail, useQuestionReview } from "@/components/session/session-results";
import type { LoadedQuestion } from "@/components/session/session-runner";
import type { FocusedResults } from "@/lib/focused/sessions";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Deliberately not SessionResults, for the same reason the 800 Club has its
// own: that component is built around a prediction update and mastery deltas,
// and a Focused Practice session produces neither by design. What it shares —
// the per-question expand — is the exported QuestionDetail, so a reviewed
// question looks identical everywhere.
export function FocusedResultsView({
  data,
  loadQuestionDetail,
}: {
  data: FocusedResults;
  loadQuestionDetail: (slotId: string) => Promise<LoadedQuestion>;
}) {
  const review = useQuestionReview(loadQuestionDetail);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10 p-4 pb-16 sm:p-8">
      <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Focused Practice · {data.difficultyLabel}
        </p>
        <h1 className="mt-3 text-page-title sm:text-page-title-lg">{data.categoryLabel}</h1>
        <p className="mt-6 font-heading text-hero font-semibold tracking-tight tabular-nums">
          {data.correct}
          <span className="text-muted-foreground">/{data.total}</span>
        </p>
        <p className="mt-2 text-muted-foreground">
          {data.accuracy}% on {data.categoryLabel}
          {data.totalSeconds !== null && ` · ${formatTime(data.totalSeconds)}`}.
        </p>
        {/* Stated plainly rather than left for a student to wonder about: a
            drill they chose themselves is not a fair sample of their ability,
            which is exactly why it is kept out of the prediction. */}
        <p className="mt-4 text-sm text-muted-foreground">
          Drills do not change your Predicted SAT Score — you chose the category and the
          difficulty, so it is not a fair read on where you stand. Your Practice Sets still do
          that.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Question Review
        </h2>
        <div className="flex flex-col divide-y divide-border border-y border-border">
          {data.questions.map((q) => (
            <div key={q.slotId}>
              <button
                type="button"
                onClick={() => review.toggle(q.slotId)}
                className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm"
                aria-expanded={review.expandedId === q.slotId}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Badge
                    variant={q.isCorrect ? "outline" : "destructive"}
                    className={
                      q.isCorrect
                        ? "border-green-600/40 bg-green-100 text-green-800 dark:border-green-500/40 dark:bg-green-900/50 dark:text-green-300"
                        : undefined
                    }
                  >
                    {q.isCorrect ? "Correct" : "Incorrect"}
                  </Badge>
                  <span className="shrink-0">Question {q.position + 1}</span>
                </span>
                <span className="shrink-0 text-muted-foreground" aria-hidden="true">
                  {review.expandedId === q.slotId ? "−" : "+"}
                </span>
              </button>
              {review.expandedId === q.slotId && (
                <div className="pb-4">
                  <ReviewDetail review={review} id={q.slotId} isCorrect={q.isCorrect} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-col gap-3 border-t border-border pt-8 sm:flex-row-reverse sm:justify-end">
        <LinkButton size="cta" href="/practice/focused">
          Drill another category
        </LinkButton>
        <LinkButton size="cta" variant="outline" href="/practice">
          Back to Practice
        </LinkButton>
      </div>
    </div>
  );
}
