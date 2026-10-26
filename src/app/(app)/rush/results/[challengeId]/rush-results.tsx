"use client";

import { ReviewDetail, useQuestionReview } from "@/components/session/session-results";
import type { LoadedQuestion } from "@/components/session/session-runner";
import type { RushParticipant, RushResults as RushResultsData } from "@/lib/rush/runs";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import type { QuestionCategory } from "@/generated/prisma/client";

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}s`;
}

// The per-question comparison and review. The hero, the share block and
// the actions are server-rendered by the page around it; this is the one
// part that needs client state (which row is expanded).
export function RushQuestionReview({
  data,
  loadQuestionDetail,
}: {
  data: RushResultsData;
  loadQuestionDetail: (challengeId: string, position: number) => Promise<LoadedQuestion>;
}) {
  // The shared review state, keyed by position as a string: a failed load
  // shows a retry in the row instead of leaving it on "Loading…" for good.
  const review = useQuestionReview((id) => loadQuestionDetail(data.challengeId, Number(id)));

  const opponent: RushParticipant | null = data.others.find((o) => o.status === "COMPLETED") ?? null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Question by question</h2>
        {opponent && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">You</span> · {opponent.name}
          </p>
        )}
      </div>
      <div className="flex flex-col divide-y divide-border border-y border-border">
        {data.questions.map((q) => {
          const mine = data.me.answers[q.position];
          const theirs = opponent?.answers[q.position] ?? null;
          return (
            <div key={q.position}>
              <button
                type="button"
                onClick={() => review.toggle(String(q.position))}
                className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm"
                aria-expanded={review.expandedId === String(q.position)}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="w-6 shrink-0 font-heading text-sm font-semibold tabular-nums text-muted-foreground">{String(q.position + 1).padStart(2, "0")}</span>
                  <span className="truncate text-xs text-muted-foreground">{CATEGORY_LABELS[q.category as QuestionCategory]}</span>
                </span>
                <span className="flex shrink-0 items-center gap-4 tabular-nums">
                  <AnswerCell answer={mine} emphasis />
                  {theirs && <AnswerCell answer={theirs} />}
                  <span className="text-muted-foreground" aria-hidden="true">
                    {review.expandedId === String(q.position) ? "−" : "+"}
                  </span>
                </span>
              </button>
              {review.expandedId === String(q.position) && (
                <div className="pb-4">
                  <ReviewDetail review={review} id={String(q.position)} isCorrect={mine.isCorrect ?? false} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AnswerCell({ answer, emphasis = false }: { answer: RushParticipant["answers"][number]; emphasis?: boolean }) {
  const mark = !answer.answered ? "—" : answer.isCorrect ? "✓" : "✗";
  const tone = !answer.answered ? "text-muted-foreground" : answer.isCorrect ? "text-green-700 dark:text-green-400" : "text-destructive";
  return (
    <span className={`flex w-24 items-baseline justify-end gap-1.5 text-xs ${emphasis ? "text-foreground" : "text-muted-foreground"}`}>
      <span className={`font-semibold ${tone}`} aria-label={!answer.answered ? "Not answered" : answer.isCorrect ? "Correct" : "Incorrect"}>
        {mark}
      </span>
      <span>{answer.points ?? 0}</span>
      {answer.elapsedMs !== null && <span className="text-muted-foreground">· {seconds(answer.elapsedMs)}</span>}
    </span>
  );
}
