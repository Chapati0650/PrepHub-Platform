"use client";

import { LinkButton } from "@/components/ui/link-button";
import { Badge } from "@/components/ui/badge";
import { ReviewDetail, useQuestionReview } from "@/components/session/session-results";
import type { LoadedQuestion } from "@/components/session/session-runner";
import type { HomeworkResults as HomeworkResultsData } from "@/lib/teacher/homework";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import type { QuestionCategory } from "@/generated/prisma/client";

// Shaped like the 800 Club's results, not SessionResults: there is no
// prediction update or mastery delta here, because homework never touches
// the adaptive engine. The per-question expand is the shared QuestionDetail,
// so a reviewed question looks the same everywhere.
export function HomeworkResults({
  data,
  loadQuestionDetail,
}: {
  data: HomeworkResultsData;
  loadQuestionDetail: (slotId: string) => Promise<LoadedQuestion>;
}) {
  // The shared review state: a failed load shows a retry in the row instead
  // of leaving it on "Loading…" for good.
  const review = useQuestionReview(loadQuestionDetail);

  const percent = data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10 p-4 pb-16 sm:p-8">
      <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Homework · {data.className}
        </p>
        <h1 className="mt-3 text-page-title sm:text-page-title-lg">{data.title}</h1>
        <p className="mt-6 font-heading text-hero font-semibold tracking-tight tabular-nums">
          {data.correct}
          <span className="text-muted-foreground">/{data.total}</span>
        </p>
        <p className="mt-2 text-muted-foreground">
          {percent}% correct · turned in{data.late ? " late" : ""}. Your teacher can see this score.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Question Review</h2>
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
                  <span className="truncate text-xs text-muted-foreground">{CATEGORY_LABELS[q.category as QuestionCategory]}</span>
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

      <div className="flex flex-col gap-3 border-t border-border pt-8 sm:flex-row-reverse sm:items-center sm:justify-end">
        <LinkButton size="cta" href="/homework">
          Back to Homework
        </LinkButton>
        {/* One pill per screen (CLAUDE.md), so the way to the dashboard is a quiet one. */}
        <LinkButton size="lg" variant="ghost" href="/home" className="text-base">
          Dashboard
        </LinkButton>
      </div>
    </div>
  );
}
