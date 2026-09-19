"use client";

import { useState } from "react";
import { LinkButton } from "@/components/ui/link-button";
import { Badge } from "@/components/ui/badge";
import { LatexText } from "@/components/content/latex-text";
import { QuestionStatement } from "@/components/content/question-statement";
import { ExplanationSteps } from "@/components/content/explanation-steps";
import { DistractorNote } from "@/components/content/distractor-note";
import { ScorePrediction } from "@/components/score-prediction";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import type { SessionResultsData } from "@/lib/session/session-results-data";
import type { LoadedQuestion } from "./session-runner";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function celebrationMessage(previous: { min: number; max: number } | null, current: { min: number; max: number }): string {
  if (!previous) return "You now have your first PrepHub Score Prediction.";
  const prevMid = (previous.min + previous.max) / 2;
  const curMid = (current.min + current.max) / 2;
  if (curMid > prevMid) return `+${Math.round(curMid - prevMid)} Estimated SAT Points`;
  if (curMid < prevMid) return "Your predicted score decreased slightly this session. That's completely normal — progress isn't always linear.";
  return "You're maintaining an excellent level.";
}

function targetProgressMessage(target: number | null, current: { min: number; max: number }): string | null {
  if (target === null) return null;
  if (target <= current.max) return "You're now within reach of your target score.";
  const remaining = target - current.max;
  return `About ${remaining} points to go to reach your target.`;
}

export function SessionResults({
  data,
  loadQuestionDetail,
  backHref = "/home",
}: {
  data: SessionResultsData;
  loadQuestionDetail: (itemId: string) => Promise<LoadedQuestion>;
  backHref?: string;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Map<string, LoadedQuestion>>(new Map());
  const [detailLoading, setDetailLoading] = useState(false);

  async function toggleQuestion(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!detailCache.has(id)) {
      setDetailLoading(true);
      const detail = await loadQuestionDetail(id);
      setDetailCache((prev) => new Map(prev).set(id, detail));
      setDetailLoading(false);
    }
  }

  const targetMessage = targetProgressMessage(data.targetScore, data.currentRange);
  const previousMid = data.previousRange ? (data.previousRange.min + data.previousRange.max) / 2 : null;
  const currentMid = (data.currentRange.min + data.currentRange.max) / 2;
  const improved = previousMid !== null && currentMid > previousMid;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10 p-4 pb-16 sm:p-8">
      {/* One results hero instead of three stacked centered blocks. The
          celebration line, the prediction and the goal readout were three
          separate center-aligned groups saying overlapping things; a student
          finishing a set wants one answer ("where am I now?") and the rest as
          supporting detail. Left-aligned for the same reason the rest of the
          app is: a centered column of short text is the default shape of a
          generated confirmation screen. */}
      <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">
        {/* The completion line stays the <h1>. It is what this page is, and
            demoting it to a styled <p> so the celebration could be the heading
            would have left the document outline claiming the page is titled
            "+40 Estimated SAT Points". The prediction still dominates visually
            — that is what the size contrast below is for. */}
        <h1 className="text-page-title sm:text-page-title-lg">
          {data.sourceType === "DIAGNOSTIC" ? "Diagnostic Complete" : "Session Complete"}
        </h1>

        <div className="mt-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <ScorePrediction
            min={data.currentRange.min}
            max={data.currentRange.max}
            label={data.sourceType === "DIAGNOSTIC" ? "Your Initial PrepHub Score Prediction" : "Your Updated PrepHub Score Prediction"}
          />
          {improved ? (
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-achievement/20 px-4 py-2 text-sm font-semibold text-achievement-foreground dark:text-achievement">
              &uarr; {celebrationMessage(data.previousRange, data.currentRange)}
            </span>
          ) : (
            <p className="max-w-xs text-sm text-muted-foreground">
              {celebrationMessage(data.previousRange, data.currentRange)}
            </p>
          )}
        </div>

        {(data.previousRange || data.targetScore !== null) && (
          <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4 border-t border-foreground/10 pt-6 text-sm">
            {data.previousRange && (
              <div>
                <dt className="text-muted-foreground">Previous</dt>
                <dd className="mt-0.5 font-semibold tabular-nums">
                  {data.previousRange.min}&ndash;{data.previousRange.max}
                </dd>
              </div>
            )}
            {data.targetScore !== null && (
              <div>
                <dt className="text-muted-foreground">Target</dt>
                <dd className="mt-0.5 font-semibold tabular-nums">{data.targetScore}</dd>
              </div>
            )}
          </dl>
        )}

        {targetMessage && <p className="mt-4 text-sm">{targetMessage}</p>}

        <p className="mt-6 text-xs text-muted-foreground">
          An estimate based on your PrepHub performance. Your actual SAT score may vary.
        </p>
      </section>

      {/* Session Breakdown */}
      <div className="grid grid-cols-2 gap-y-6 divide-border sm:grid-cols-4 sm:divide-x">
        <Stat label="Correct" value={`${data.stats.correct}/${data.stats.total}`} />
        <Stat label="Accuracy" value={`${data.stats.accuracy}%`} />
        <Stat label="Avg. Time" value={formatTime(data.stats.avgTimeSeconds)} />
        <Stat label="Total Time" value={formatTime(data.stats.totalTimeSeconds)} />
      </div>

      {/* Mastery Breakdown */}
      <div className="flex flex-col gap-4">
        <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Mastery by Category</h2>
        {data.mastery.map((m) => (
          <div key={m.category}>
            <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
              <span>{CATEGORY_LABELS[m.category]}</span>
              {m.changeSinceStart !== null && (
                <span className={m.changeSinceStart >= 0 ? "font-medium text-achievement-foreground dark:text-achievement" : "text-destructive"}>
                  {m.changeSinceStart >= 0 ? "+" : ""}
                  {m.changeSinceStart}%
                </span>
              )}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={m.currentMastery} aria-valuemin={0} aria-valuemax={100} aria-label={`${CATEGORY_LABELS[m.category]} mastery`}>
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${m.currentMastery}%` }} />
            </div>
          </div>
        ))}
      </div>

      {/* Question Review */}
      <div className="flex flex-col gap-4">
        <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Question Review</h2>
        {/* One continuous ruled list rather than 21 separately bordered cards:
            at set length, individual boxes turn the review into a wall of
            outlines and it stops being scannable. */}
        <div className="flex flex-col divide-y divide-border border-y border-border">
          {data.questions.map((q) => (
            <div key={q.id}>
              <button
                type="button"
                onClick={() => void toggleQuestion(q.id)}
                className="flex w-full items-center justify-between gap-3 py-3 text-left text-sm"
                aria-expanded={expandedId === q.id}
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
                  <span className="truncate text-xs text-muted-foreground">{CATEGORY_LABELS[q.category]}</span>
                </span>
                <span className="shrink-0 text-muted-foreground" aria-hidden="true">
                  {expandedId === q.id ? "−" : "+"}
                </span>
              </button>

              {expandedId === q.id && (
                <div className="pb-4">
                  {detailLoading && !detailCache.has(q.id) ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : (
                    <QuestionDetail loaded={detailCache.get(q.id)!} isCorrect={q.isCorrect} />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex flex-col gap-3 border-t border-border pt-8 sm:flex-row-reverse sm:justify-end">
        <LinkButton size="cta" href={data.continueHref}>
          Continue Practice
        </LinkButton>
        <LinkButton size="cta" variant="outline" href={backHref}>
          Back to Dashboard
        </LinkButton>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="sm:px-5 sm:first:pl-0 sm:last:pr-0">
      <p className="font-heading text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function QuestionDetail({ loaded, isCorrect }: { loaded: LoadedQuestion; isCorrect: boolean }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <QuestionStatement text={loaded.content.questionText} imageId={loaded.content.questionImageId} mediaBasePath="/api/media" />
      {loaded.content.questionType === "MULTIPLE_CHOICE" && (
        <div className="flex flex-col gap-1.5">
          {loaded.content.answerChoices.map((choice) => {
            const showCorrect = loaded.feedback?.correctChoiceId === choice.id;
            const showWrongSelection = !showCorrect && loaded.studentAnswer === choice.id;
            return (
              <div
                key={choice.id}
                className={`rounded-md border p-2 text-sm ${
                  showCorrect
                    ? "border-2 border-green-600 bg-green-100 dark:border-green-500 dark:bg-green-900/50"
                    : showWrongSelection
                      ? "border-destructive bg-destructive/5"
                      : "border-border"
                }`}
              >
                <LatexText text={choice.text} />
              </div>
            );
          })}
        </div>
      )}
      {loaded.content.questionType === "OPEN_ENDED_NUMERIC" && loaded.feedback && (
        <p className="text-muted-foreground">Accepted answer: {loaded.feedback.acceptedAnswers[0]}</p>
      )}
      <p className={`font-medium ${isCorrect ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>
        {isCorrect ? "Correct" : "Incorrect"}
      </p>
      {!isCorrect && loaded.studentAnswer && loaded.feedback?.distractorExplanationsByChoiceId[loaded.studentAnswer] && (
        <DistractorNote text={loaded.feedback.distractorExplanationsByChoiceId[loaded.studentAnswer]} />
      )}
      {loaded.feedback && loaded.feedback.explanationSteps.length > 0 ? (
        <ExplanationSteps steps={loaded.feedback.explanationSteps} mediaBasePath="/api/media" />
      ) : (
        loaded.feedback?.writtenExplanation && (
          <div className="rounded-md bg-muted p-3">
            <LatexText text={loaded.feedback.writtenExplanation} />
          </div>
        )
      )}
      {loaded.feedback?.explanationVideoId && (
        <video controls className="w-full rounded" src={`/api/media/${loaded.feedback.explanationVideoId}`} />
      )}
    </div>
  );
}
