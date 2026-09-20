"use client";

import { useState } from "react";
import { QuestionDetail } from "@/components/session/session-results";
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
  const [expanded, setExpanded] = useState<number | null>(null);
  const [cache, setCache] = useState<Map<number, LoadedQuestion>>(new Map());
  const [loading, setLoading] = useState(false);

  const opponent: RushParticipant | null = data.others.find((o) => o.status === "COMPLETED") ?? null;

  async function toggle(position: number) {
    if (expanded === position) return setExpanded(null);
    setExpanded(position);
    if (!cache.has(position)) {
      setLoading(true);
      const detail = await loadQuestionDetail(data.challengeId, position);
      setCache((prev) => new Map(prev).set(position, detail));
      setLoading(false);
    }
  }

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
                onClick={() => void toggle(q.position)}
                className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm"
                aria-expanded={expanded === q.position}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="w-6 shrink-0 font-heading text-sm font-semibold tabular-nums text-muted-foreground">{String(q.position + 1).padStart(2, "0")}</span>
                  <span className="truncate text-xs text-muted-foreground">{CATEGORY_LABELS[q.category as QuestionCategory]}</span>
                </span>
                <span className="flex shrink-0 items-center gap-4 tabular-nums">
                  <AnswerCell answer={mine} emphasis />
                  {theirs && <AnswerCell answer={theirs} />}
                  <span className="text-muted-foreground" aria-hidden="true">
                    {expanded === q.position ? "−" : "+"}
                  </span>
                </span>
              </button>
              {expanded === q.position && (
                <div className="pb-4">
                  {loading && !cache.has(q.position) ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : (
                    <QuestionDetail loaded={cache.get(q.position)!} isCorrect={mine.isCorrect ?? false} />
                  )}
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
