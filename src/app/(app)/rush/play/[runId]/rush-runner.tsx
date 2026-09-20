"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { LatexText } from "@/components/content/latex-text";
import { QuestionStatement } from "@/components/content/question-statement";
import { Calculator } from "@/components/session/calculator";
import { RUSH_BASE_POINTS, RUSH_SPEED_POINTS } from "@/lib/rush/config";
import type { RunContext, RushAnswerResult, ServedQuestion } from "@/lib/rush/runs";

type Phase = "intro" | "loading" | "question" | "feedback" | "error";

// How long the ✓/✗ + points linger before the next question is served. The
// next question's clock starts only when it is served, so this pause never
// costs time.
const FEEDBACK_MS = 1400;

function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(1).replace(/\.0$/, "");
}

// Deliberately not SessionRunner. That component is a browse-and-return
// flow (skip, revisit, nav grid, draft autosave) built for a 21-question
// set with no clock; a rush is strictly linear with a hard per-question
// timer and no going back, and bending the shared runner to that would
// have given both surfaces a worse version of the other's rules. What it
// shares — QuestionStatement, LatexText, the A/B/C/D choice markup, the
// Calculator — is shared by import.
export function RushRunner({
  run,
  serve,
  submit,
}: {
  run: RunContext;
  serve: (runId: string) => Promise<ServedQuestion | null>;
  submit: (runId: string, position: number, answer: string | null) => Promise<RushAnswerResult>;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("intro");
  const [current, setCurrent] = useState<ServedQuestion | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [remainingMs, setRemainingMs] = useState(0);
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<RushAnswerResult | null>(null);
  const [score, setScore] = useState(run.score);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const resultsHref = `/rush/results/${run.challengeId}`;

  async function loadNext() {
    setPhase("loading");
    setDraft("");
    setResult(null);
    try {
      const q = await serve(run.id);
      if (!q) {
        router.replace(resultsHref);
        return;
      }
      setCurrent(q);
      // Count down from this device's clock, not the server's: the server
      // already subtracted whatever had elapsed, so a skewed clock can't
      // lengthen or shorten a question.
      setDeadline(Date.now() + q.remainingMs);
      setRemainingMs(q.remainingMs);
      setPhase("question");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("error");
    }
  }

  async function submitAnswer(answer: string | null) {
    if (!current || inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await submit(run.id, current.position, answer);
      setResult(r);
      setScore(r.score);
      setPhase("feedback");
      window.setTimeout(() => {
        if (r.done) router.replace(resultsHref);
        else void loadNext();
      }, FEEDBACK_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPhase("error");
    } finally {
      inFlight.current = false;
    }
  }

  // The interval needs the *latest* submitAnswer (it closes over `current`),
  // but re-creating the interval on every render would make the tick
  // stutter. A ref refreshed in an effect gives the callback a stable
  // handle to the newest function without writing a ref during render.
  const submitRef = useRef(submitAnswer);
  useEffect(() => {
    submitRef.current = submitAnswer;
  });

  useEffect(() => {
    if (phase !== "question") return;
    const id = window.setInterval(() => {
      const r = deadline - Date.now();
      if (r <= 0) {
        window.clearInterval(id);
        setRemainingMs(0);
        void submitRef.current(null);
      } else {
        setRemainingMs(r);
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [phase, deadline]);

  const eyebrow = `1v1 Rush · ${run.sectionLabel} · ${run.difficultyLabel}`;

  if (phase === "intro") {
    const resuming = run.position > 0;
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-8 p-4 pb-16 sm:p-8">
        <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">
          <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">{eyebrow}</p>
          <h1 className="mt-3 text-display-sm sm:text-display">{resuming ? "Pick up where you left off." : "Ready?"}</h1>
          <p className="mt-4 max-w-prose text-muted-foreground">
            {run.total} questions, {Math.round(run.limitMs / 1000)} seconds each. A correct answer is {RUSH_BASE_POINTS} points plus up to{" "}
            {RUSH_SPEED_POINTS} for speed; wrong or out of time is zero. There&apos;s no going back — choosing an answer locks it in and
            the next question comes up.
          </p>
          {run.opponentName && (
            <p className="mt-3 max-w-prose text-muted-foreground">
              You&apos;re racing <span className="font-medium text-foreground">{run.opponentName}</span>, who has already played
              these ten. Their time on each question shows as you go.
            </p>
          )}
          <p className="mt-3 text-sm text-muted-foreground">
            {resuming ? `You're on question ${run.position + 1} of ${run.total}.` : "The clock starts on the first question when you press Start."}
          </p>
          <div className="mt-8">
            <Button size="cta" onClick={() => void loadNext()}>
              {resuming ? "Resume" : "Start"}
            </Button>
          </div>
        </section>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-4 pb-16 sm:p-8">
        <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">
          <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">{eyebrow}</p>
          <h1 className="mt-3 text-page-title">Something went wrong.</h1>
          <p className="mt-3 text-muted-foreground">{error ?? "Please try again."}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button size="cta" onClick={() => void loadNext()}>
              Try again
            </Button>
            <LinkButton size="cta" variant="ghost" href="/rush">
              Back to 1v1 Rush
            </LinkButton>
          </div>
        </section>
      </div>
    );
  }

  if (phase === "loading" || !current) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4 pb-16 sm:p-8">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">{eyebrow}</h1>
          <span className="text-sm tabular-nums text-muted-foreground">{score} pts</span>
        </div>
        <div className="py-16 text-sm text-muted-foreground">Loading question…</div>
      </div>
    );
  }

  const fraction = Math.max(0, Math.min(1, remainingMs / current.limitMs));
  const answered = phase === "feedback";
  const urgent = !answered && fraction < 0.25;
  const critical = !answered && fraction < 0.1;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4 pb-16 sm:p-8">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">{eyebrow}</h1>
        <span className="text-sm tabular-nums text-muted-foreground">
          Question {current.position + 1} of {current.total}
          <span className="mx-2 text-border" aria-hidden>
            |
          </span>
          <span className="font-medium text-foreground">{score}</span> pts
        </span>
      </div>

      {/* The clock. A bar, not a ticking number, as the primary cue: it is
          readable from the corner of the eye while the question has the
          focus. The seconds are still there for anyone who wants them. */}
      <div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10" aria-hidden>
          <div
            className={[
              "h-full rounded-full transition-[width] duration-100 ease-linear",
              critical ? "bg-destructive" : urgent ? "bg-amber-500" : "bg-primary",
            ].join(" ")}
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-xs tabular-nums text-muted-foreground">
          <span aria-live="off" className={critical ? "font-medium text-destructive" : undefined}>
            {Math.ceil(remainingMs / 1000)}s left
          </span>
          {current.ghost && (
            <span>
              {current.ghost.name} answered in {formatSeconds(current.ghost.elapsedMs)}s{" "}
              <span className={current.ghost.isCorrect ? "text-green-700 dark:text-green-400" : "text-destructive"}>
                {current.ghost.isCorrect ? "✓" : "✗"}
              </span>
            </span>
          )}
        </div>
      </div>

      <div>
        <QuestionStatement text={current.content.questionText} imageId={current.content.questionImageId} mediaBasePath="/api/media" textClassName="text-lg leading-relaxed" />

        {current.content.calculatorSetting === "ALLOWED" && (
          <div className="mt-4">
            <Calculator />
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2.5">
          {current.content.questionType === "MULTIPLE_CHOICE" ? (
            current.content.answerChoices.map((choice, choiceIndex) => {
              const isSelected = draft === choice.id;
              const showCorrect = answered && result?.correctChoiceId === choice.id;
              const showWrongSelection = answered && isSelected && result?.correctChoiceId !== choice.id;
              return (
                <button
                  key={choice.id}
                  type="button"
                  disabled={answered}
                  onClick={() => {
                    setDraft(choice.id);
                    void submitAnswer(choice.id);
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
                if (draft.trim()) void submitAnswer(draft.trim());
              }}
            >
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
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

        {answered && result && (
          <div role="status" className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className={`font-heading text-lg font-semibold ${result.points > 0 ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>
              {result.timedOut || result.overLimit ? "Time's up." : result.isCorrect ? "Correct!" : "Incorrect."}
            </p>
            <p className="text-sm tabular-nums text-muted-foreground">
              {result.points > 0 ? `+${result.points} pts` : "0 pts"} · {formatSeconds(result.elapsedMs)}s
            </p>
            {current.content.questionType === "OPEN_ENDED_NUMERIC" && !result.isCorrect && result.acceptedAnswer && (
              <p className="w-full text-sm text-muted-foreground">Accepted answer: {result.acceptedAnswer}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
