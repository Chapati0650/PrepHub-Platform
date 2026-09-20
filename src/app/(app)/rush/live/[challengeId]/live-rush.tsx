"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { LIVE_LOBBY_POLL_MS, LIVE_POLL_MS, LIVE_RANDOM_FALLBACK_MS } from "@/lib/rush/config";
import type { LiveAnswerResult, LiveRoundAnswer, LiveServedQuestion, LiveState } from "@/lib/rush/live";
import { ShareChallenge } from "../../share-challenge";
import { RushQuestion, TimeBar, formatSeconds } from "../../rush-question";
import { fallbackToRecordedAction, leaveLiveRoomAction } from "../../actions";

// The live room, start to finish: lobby → countdown → ten shared questions
// → results. The server owns every clock (see lib/rush/live.ts); this
// component polls it once a second and draws what it's told. Between
// polls the countdowns run on this device's clock from the last
// server-reported remainder, so they never drift more than a poll.
export function LiveRush({
  initial,
  joinUrl,
  poll,
  serve,
  submit,
}: {
  initial: LiveState;
  joinUrl: string;
  poll: (challengeId: string) => Promise<LiveState | null>;
  serve: (challengeId: string) => Promise<LiveServedQuestion | { notYet: true }>;
  submit: (challengeId: string, position: number, answer: string | null) => Promise<LiveAnswerResult | { over: true }>;
}) {
  const router = useRouter();
  const id = initial.challengeId;
  const [state, setState] = useState<LiveState>(initial);
  const [question, setQuestion] = useState<LiveServedQuestion | null>(null);
  const [deadline, setDeadline] = useState(0); // local: when the open question closes
  const [startsAt, setStartsAt] = useState(0); // local: countdown / next-question instant
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<LiveAnswerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const fetching = useRef(false);
  // Set when Leave / "Race a recorded run" is submitted: those actions
  // delete the room, and the next poll would otherwise see "no room" and
  // bounce to the hub before the action's own redirect lands.
  const leaving = useRef(false);
  const resultsHref = `/rush/results/${id}`;

  // ---- Poll -----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    async function loop() {
      let next: LiveState | null = null;
      try {
        next = await poll(id);
      } catch {
        // A blip. Keep the last state and try again on the next tick.
      }
      if (cancelled || leaving.current) return;
      if (next === null) {
        // Only null when this student has no run here (or the room was
        // deleted) — nothing to draw.
        router.replace("/rush");
        return;
      }
      if (next) {
        setState(next);
        const t = Date.now();
        if (next.startsInMs !== null) setStartsAt(t + next.startsInMs);
        if (next.nextStartsInMs !== null) setStartsAt(t + next.nextStartsInMs);
        if (next.questionOpen) setDeadline(t + next.remainingMs);
        if (next.status === "FINISHED") {
          router.replace(resultsHref);
          return;
        }
      }
      timer = window.setTimeout(loop, next?.status === "WAITING" ? LIVE_LOBBY_POLL_MS : LIVE_POLL_MS);
    }
    timer = window.setTimeout(loop, LIVE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [id, poll, router, resultsHref]);

  // ---- Local 100ms clock while anything is counting -----------------
  const counting = state.status === "COUNTDOWN" || state.status === "PLAYING";
  useEffect(() => {
    if (!counting) return;
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, [counting]);

  // ---- Fetch the question the moment its shared clock opens ----------
  const needQuestion = state.status === "PLAYING" && (question === null || question.position !== state.position);
  async function fetchQuestion(attempt = 0) {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const q = await serve(id);
      if ("notYet" in q) {
        // This device is a hair ahead of the server. Retry shortly.
        if (attempt < 8) window.setTimeout(() => void fetchQuestion(attempt + 1), 150);
        return;
      }
      setQuestion(q);
      setDraft("");
      setResult(null);
      setDeadline(Date.now() + q.remainingMs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      fetching.current = false;
    }
  }
  const fetchRef = useRef(fetchQuestion);
  useEffect(() => {
    fetchRef.current = fetchQuestion;
  });
  useEffect(() => {
    if (!needQuestion) return;
    if (state.questionOpen) {
      void fetchRef.current();
      return;
    }
    // In the gap: schedule the fetch for the instant the next question
    // opens, so neither player waits a whole poll to see it.
    if (state.nextStartsInMs === null) return;
    const t = window.setTimeout(() => void fetchRef.current(), state.nextStartsInMs + 60);
    return () => window.clearTimeout(t);
  }, [needQuestion, state.questionOpen, state.nextStartsInMs, state.position]);

  // ---- Answering -------------------------------------------------------
  async function submitAnswer(answer: string | null) {
    if (!question || inFlight.current || result) return;
    inFlight.current = true;
    try {
      const r = await submit(id, question.position, answer);
      if ("over" in r) return; // the room moved on; the poll will redraw
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      inFlight.current = false;
    }
  }
  const submitRef = useRef(submitAnswer);
  useEffect(() => {
    submitRef.current = submitAnswer;
  });
  const questionLive = state.status === "PLAYING" && state.questionOpen && question?.position === state.position;
  const remainingMs = questionLive ? Math.max(0, deadline - now) : 0;
  const answered = result !== null || state.me.answered !== null;
  useEffect(() => {
    if (!questionLive || answered || remainingMs > 0) return;
    void submitRef.current(null);
  }, [questionLive, answered, remainingMs]);

  // ---- Screens ---------------------------------------------------------
  const eyebrow = `1v1 Rush · Live · ${state.sectionLabel}`;
  const opp = state.opponent;

  if (error) {
    return (
      <Shell eyebrow={eyebrow}>
        <h1 className="mt-3 text-page-title">Something went wrong.</h1>
        <p className="mt-3 text-muted-foreground">{error}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button size="cta" onClick={() => window.location.reload()}>
            Reload the room
          </Button>
          <LinkButton size="cta" variant="ghost" href="/rush">
            Back to 1v1 Rush
          </LinkButton>
        </div>
      </Shell>
    );
  }

  if (state.status === "WAITING") {
    const friend = state.mode === "FRIEND";
    const offerFallback = !friend && state.waitedMs >= LIVE_RANDOM_FALLBACK_MS;
    return (
      <Shell eyebrow={eyebrow}>
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <span className="relative flex size-2.5" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
          </span>
          {friend ? "Room open" : "Looking for an opponent"}
        </p>
        <h1 className="mt-3 text-display-sm sm:text-display">{friend ? "Your room is open." : "Finding you someone…"}</h1>
        <p className="mt-4 max-w-prose text-muted-foreground">
          {friend
            ? "Send this to a friend. The five-second countdown starts the moment they join, and you'll play the same ten questions on the same clock."
            : `You'll be matched with the next student who starts a live ${state.sectionLabel} rush. Keep this page open — the countdown starts the moment they arrive.`}
        </p>
        {friend && (
          <div className="mt-6 rounded-2xl border border-border bg-background p-5">
            <ShareChallenge code={state.code} joinUrl={joinUrl} />
          </div>
        )}
        {offerFallback && (
          <form
            action={fallbackToRecordedAction}
            onSubmit={() => {
              leaving.current = true;
            }}
            className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-background p-5"
          >
            <input type="hidden" name="challengeId" value={id} />
            <input type="hidden" name="section" value={state.section} />
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">Nobody yet. You can race another student&apos;s recorded run instead — same ten-question format, their times as your pace.</p>
            <Button type="submit" variant="outline" className="rounded-full">
              Race a recorded run
            </Button>
          </form>
        )}
        <form
          action={leaveLiveRoomAction}
          onSubmit={() => {
            leaving.current = true;
          }}
          className="mt-8"
        >
          <input type="hidden" name="challengeId" value={id} />
          <Button type="submit" variant="ghost" className="rounded-full">
            Leave
          </Button>
        </form>
      </Shell>
    );
  }

  if (state.status === "COUNTDOWN" || !opp) {
    const secs = Math.max(0, Math.ceil((startsAt - now) / 1000));
    return (
      <Shell eyebrow={eyebrow}>
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{state.me.name}</span> vs <span className="font-medium text-foreground">{opp?.name ?? "…"}</span>
        </p>
        <h1 className="mt-3 text-display-sm sm:text-display">Starting in</h1>
        <p className="mt-2 font-heading text-hero font-semibold tracking-tight tabular-nums" aria-live="polite">
          {secs}
        </p>
        <p className="mt-2 max-w-prose text-muted-foreground">
          {state.total} questions, {Math.round(state.limitMs / 1000)} seconds each, the same clock for both of you. Choosing an answer locks it in.
        </p>
      </Shell>
    );
  }

  // PLAYING
  const inGap = !state.questionOpen;
  const gapSecs = Math.max(0, Math.ceil((startsAt - now) / 1000));
  const mine: LiveRoundAnswer | null = result ?? state.me.answered;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-4 pb-16 sm:p-8">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">{eyebrow}</h1>
        <span className="text-sm tabular-nums text-muted-foreground">
          Question {Math.min(state.position + 1, state.total)} of {state.total}
        </span>
      </div>

      {/* Scoreboard — the whole reason this mode exists is the other number. */}
      <div className="grid grid-cols-2 divide-x divide-border rounded-2xl border border-border">
        <Score name="You" score={result?.score ?? state.me.score} mark={mine} />
        <Score name={opp.name} score={opp.score} mark={opp.answered} present={opp.present} right />
      </div>

      {inGap || !questionLive || !question ? (
        <div className="py-10">
          {state.lastRound && inGap ? (
            <RoundSummary me={state.lastRound.me} opp={state.lastRound.opponent} oppName={opp.name} />
          ) : (
            <p className="text-sm text-muted-foreground">Loading question…</p>
          )}
          {inGap && <p className="mt-4 text-sm tabular-nums text-muted-foreground">Next question in {gapSecs}s</p>}
        </div>
      ) : (
        <>
          <TimeBar
            remainingMs={remainingMs}
            limitMs={state.limitMs}
            frozen={answered}
            right={
              opp.answered ? (
                <span>
                  {opp.name} answered in {formatSeconds(opp.answered.elapsedMs)}s{" "}
                  <span className={opp.answered.isCorrect ? "text-green-700 dark:text-green-400" : "text-destructive"}>{opp.answered.isCorrect ? "✓" : "✗"}</span>
                </span>
              ) : (
                <span>{opp.present ? `${opp.name} is thinking…` : `${opp.name} dropped — their questions time out`}</span>
              )
            }
          />
          <RushQuestion
            content={question.content}
            draft={draft}
            answered={answered}
            correctChoiceId={result?.correctChoiceId ?? null}
            onDraftChange={setDraft}
            onAnswer={(a) => void submitAnswer(a)}
          />
          {mine && (
            <div role="status" className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className={`font-heading text-lg font-semibold ${mine.points > 0 ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>
                {mine.timedOut ? "Time's up." : mine.isCorrect ? "Correct!" : "Incorrect."}
              </p>
              <p className="text-sm tabular-nums text-muted-foreground">
                {mine.points > 0 ? `+${mine.points} pts` : "0 pts"} · {formatSeconds(mine.elapsedMs)}s
              </p>
              {!opp.answered && <p className="w-full text-sm text-muted-foreground">Waiting for {opp.name}…</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Shell({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 p-4 pb-16 sm:p-8">
      <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">{eyebrow}</p>
        {children}
      </section>
    </div>
  );
}

function Score({ name, score, mark, present = true, right = false }: { name: string; score: number; mark: LiveRoundAnswer | null; present?: boolean; right?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 p-4 ${right ? "flex-row-reverse text-right" : ""}`}>
      <div>
        <p className="text-sm text-muted-foreground">
          {name}
          {!present && <span className="ml-1.5 text-xs">(away)</span>}
        </p>
        <p className="font-heading text-3xl font-semibold tracking-tight tabular-nums">{score}</p>
      </div>
      <span
        aria-label={mark ? (mark.isCorrect ? "Answered correctly" : "Answered incorrectly") : "Not answered yet"}
        className={`font-heading text-2xl font-semibold ${mark ? (mark.isCorrect ? "text-green-700 dark:text-green-400" : "text-destructive") : "text-muted-foreground/40"}`}
      >
        {mark ? (mark.isCorrect ? "✓" : "✗") : "·"}
      </span>
    </div>
  );
}

function RoundSummary({ me, opp, oppName }: { me: LiveRoundAnswer | null; opp: LiveRoundAnswer | null; oppName: string }) {
  const line = (label: string, a: LiveRoundAnswer | null) => (
    <p className="flex items-baseline gap-3 text-sm tabular-nums">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      {a ? (
        <>
          <span className={`font-semibold ${a.isCorrect ? "text-green-700 dark:text-green-400" : "text-destructive"}`}>{a.timedOut ? "Time's up" : a.isCorrect ? "Correct" : "Incorrect"}</span>
          <span>{a.points > 0 ? `+${a.points}` : "0"} pts</span>
          <span className="text-muted-foreground">{formatSeconds(a.elapsedMs)}s</span>
        </>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </p>
  );
  return (
    <div className="flex flex-col gap-2">
      {line("You", me)}
      {line(oppName, opp)}
    </div>
  );
}
