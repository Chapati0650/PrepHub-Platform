"use client";

import { useState } from "react";
import { LinkButton } from "@/components/ui/link-button";
import { Badge } from "@/components/ui/badge";
import { QuestionDetail } from "@/components/session/session-results";
import type { LoadedQuestion } from "@/components/session/session-runner";
import type { ClubResults as ClubResultsData } from "@/lib/club/sessions";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import type { QuestionCategory } from "@/generated/prisma/client";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Deliberately not SessionResults: that component is built around a
// prediction update and mastery deltas, and an 800 Club session produces
// neither. What it shares — the per-question expand — is the exported
// QuestionDetail, so a reviewed question looks identical in both places.
export function ClubResults({
  data,
  loadQuestionDetail,
}: {
  data: ClubResultsData;
  loadQuestionDetail: (slotId: string) => Promise<LoadedQuestion>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cache, setCache] = useState<Map<string, LoadedQuestion>>(new Map());
  const [loading, setLoading] = useState(false);

  async function toggle(id: string) {
    if (expandedId === id) return setExpandedId(null);
    setExpandedId(id);
    if (!cache.has(id)) {
      setLoading(true);
      const detail = await loadQuestionDetail(id);
      setCache((prev) => new Map(prev).set(id, detail));
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10 p-4 pb-16 sm:p-8">
      <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">800 Club · {data.sectionLabel}</p>
        <h1 className="mt-3 text-page-title sm:text-page-title-lg">Session Complete</h1>
        <p className="mt-6 font-heading text-hero font-semibold tracking-tight tabular-nums">
          {data.correct}
          <span className="text-muted-foreground">/{data.total}</span>
        </p>
        <p className="mt-2 text-muted-foreground">
          {data.accuracy}% on the hardest questions in the bank
          {data.totalSeconds !== null && ` · ${formatTime(data.totalSeconds)}`}.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Question Review</h2>
        <div className="flex flex-col divide-y divide-border border-y border-border">
          {data.questions.map((q) => (
            <div key={q.slotId}>
              <button
                type="button"
                onClick={() => void toggle(q.slotId)}
                className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm"
                aria-expanded={expandedId === q.slotId}
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
                  {expandedId === q.slotId ? "−" : "+"}
                </span>
              </button>
              {expandedId === q.slotId && (
                <div className="pb-4">
                  {loading && !cache.has(q.slotId) ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : (
                    <QuestionDetail loaded={cache.get(q.slotId)!} isCorrect={q.isCorrect} />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-col gap-3 border-t border-border pt-8 sm:flex-row-reverse sm:justify-end">
        <LinkButton size="cta" href="/800-club">
          Back to the 800 Club
        </LinkButton>
        <LinkButton size="cta" variant="outline" href="/home">
          Dashboard
        </LinkButton>
      </div>
    </div>
  );
}
