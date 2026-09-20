"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { RUSH_BASE_POINTS, RUSH_SPEED_POINTS } from "@/lib/rush/config";
import type { RunContext, RushAnswerResult, ServedQuestion } from "@/lib/rush/runs";
import { RushQuestion, TimeBar, formatSeconds } from "../../rush-question";

type Phase = "intro" | "loading" | "question" | "feedback" | "error";

// How long the ✓/✗ + points linger before the next question is served. The
// next question's clock starts only when it is served, so this pause never
// costs time.
const FEEDBACK_MS = 1400;

// The recorded (asynchronous) runner: solo, a friend's "anytime" challenge,
// or a random opponent's recorded run. Deliberately not SessionRunner —
// that is a browse-and-return flow (skip, revisit, nav grid, drafts) built
// for a 21-question set with no clock; a rush is strictly linear with a
// hard per-question timer and no going back. The question markup itself is
// RushQuestion, shared with the live room.
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

  const eyebrow = `1v1 Rush · ${run.sectionLabel}`;

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

  const answered = phase === "feedback";

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

      <TimeBar
        remainingMs={remainingMs}
        limitMs={current.limitMs}
        frozen={answered}
        right={
          current.ghost ? (
            <span>
              {current.ghost.name} answered in {formatSeconds(current.ghost.elapsedMs)}s{" "}
              <span className={current.ghost.isCorrect ? "text-green-700 dark:text-green-400" : "text-destructive"}>{current.ghost.isCorrect ? "✓" : "✗"}</span>
            </span>
          ) : undefined
        }
      />

      <RushQuestion
        content={current.content}
        draft={draft}
        answered={answered}
        correctChoiceId={result?.correctChoiceId ?? null}
        onDraftChange={setDraft}
        onAnswer={(a) => void submitAnswer(a)}
      />

      {answered && result && (
        <div role="status" className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
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
  );
}
