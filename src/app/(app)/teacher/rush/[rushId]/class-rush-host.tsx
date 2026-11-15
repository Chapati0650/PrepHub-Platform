"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { LatexText } from "@/components/content/latex-text";
import { cn } from "@/lib/utils";
import { isStaleServerActionError } from "@/lib/stale-build";
import type { ClassRushConsole } from "@/lib/rush/class-rush";
import { closeClassRushQuestionAction, createClassRushAction, endClassRushAction, startClassRushAction } from "../actions";

const POLL_MS = 1_000;

function secondsLeft(untilMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((untilMs - nowMs) / 1000));
}

/**
 * The teacher's Class Rush screen (2026-11-15), made to be projected: the join
 * instructions and who's in, a countdown, each question's clock and how many
 * have answered, then the answer and the leaderboard, then a podium. Large
 * type throughout: it's read from the back of a classroom.
 */
export function ClassRushHost({ initial, rushId, site }: { initial: ClassRushConsole; rushId: string; site: string }) {
  const [state, setState] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [stale, setStale] = useState(false);
  const [pending, startTransition] = useTransition();
  // The server's clock minus this one, so every countdown here is the room's.
  const [offset, setOffset] = useState(() => initial.serverNow - Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    async function poll() {
      try {
        const res = await fetch(`/api/class-rush/console/${rushId}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as ClassRushConsole;
          if (!cancelled) {
            setOffset(next.serverNow - Date.now());
            setState(next);
          }
        }
      } catch {
        // A dropped request on a school network: keep the last state, try again.
      }
      if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
    }
    timer = window.setTimeout(poll, POLL_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(clock);
    };
  }, [rushId]);

  const serverNow = now + offset;

  function act(work: () => Promise<unknown>) {
    startTransition(async () => {
      try {
        await work();
      } catch (err) {
        if (isStaleServerActionError(err)) setStale(true);
      }
    });
  }

  const header = (
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <p className="text-lg font-medium text-muted-foreground">
        Class Rush · {state.className} · {state.sectionLabel}
      </p>
      {state.status !== "FINISHED" && (
        <Button variant="ghost" size="xl" disabled={pending} onClick={() => act(() => endClassRushAction(rushId))}>
          End game
        </Button>
      )}
    </div>
  );

  if (stale) {
    return (
      <Screen>
        <h1 className="text-display-sm">PrepHub was just updated.</h1>
        <p className="text-xl text-muted-foreground">Reload this page; the game carries on where it is.</p>
        <Button size="cta" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </Screen>
    );
  }

  if (state.phase === "LOBBY") {
    return (
      <Screen>
        {header}
        <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-start">
          <div className="flex flex-col gap-6">
            <h1 className="text-display sm:text-display-lg">Join the Class Rush</h1>
            <ol className="flex flex-col gap-4 text-2xl leading-snug">
              <li>
                <span className="font-heading font-semibold tabular-nums">01</span> Open <span className="font-semibold">{site}</span> and sign in
              </li>
              <li>
                <span className="font-heading font-semibold tabular-nums">02</span> Press <span className="font-semibold">Join</span> on the Class Rush banner
              </li>
            </ol>
            <p className="text-lg text-muted-foreground">
              {state.total} questions, up to {Math.round(state.limitMs / 1000)} seconds each. Points for being right, more for being fast.
            </p>
            <div>
              <Button size="cta" className="h-14 px-8 text-lg" disabled={pending || state.players === 0} onClick={() => act(() => startClassRushAction(rushId))}>
                {state.players === 0 ? "Waiting for players" : `Start with ${state.players} player${state.players === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
          <div className="rounded-3xl bg-surface-tint p-6 sm:p-8">
            <p className="font-heading text-6xl font-semibold tabular-nums">{state.players}</p>
            <p className="text-xl text-muted-foreground">{state.players === 1 ? "player in" : "players in"}</p>
            <ul className="mt-6 flex flex-wrap gap-2" aria-live="polite">
              {state.roster.map((p, i) => (
                <li key={`${i}-${p.name}`} className="rounded-full bg-background px-4 py-1.5 text-lg font-medium">
                  {p.name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Screen>
    );
  }

  if (state.phase === "COUNTDOWN") {
    const s = state.openedAt ? secondsLeft(state.openedAt, serverNow) : 0;
    return (
      <Screen>
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
          <p className="text-2xl text-muted-foreground">{state.position === 0 ? "Get ready" : `Question ${state.position + 1} of ${state.total}`}</p>
          <p className="font-heading text-[10rem] leading-none font-semibold tabular-nums" aria-live="assertive">
            {s > 0 ? s : "Go!"}
          </p>
        </div>
      </Screen>
    );
  }

  if (state.phase === "QUESTION") {
    const deadline = (state.openedAt ?? 0) + state.limitMs;
    const remaining = Math.max(0, deadline - serverNow);
    return (
      <Screen>
        {header}
        <div className="flex flex-wrap items-end justify-between gap-6">
          <h1 className="text-display-sm sm:text-display">
            Question {state.position + 1} <span className="text-muted-foreground">of {state.total}</span>
          </h1>
          <p className="font-heading text-7xl font-semibold tabular-nums" aria-label={`${secondsLeft(deadline, serverNow)} seconds left`}>
            {secondsLeft(deadline, serverNow)}
          </p>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
          <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${(remaining / state.limitMs) * 100}%` }} />
        </div>
        <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-start">
          {state.question && (
            <div className="rounded-3xl border border-border p-6 text-2xl leading-relaxed sm:p-8">
              <LatexText text={state.question.text} />
              <p className="mt-4 text-lg text-muted-foreground">The full question, with its passage and choices, is on every student&apos;s screen.</p>
            </div>
          )}
          <div className="rounded-3xl bg-surface-tint p-6 text-center sm:p-8 lg:min-w-64">
            <p className="font-heading text-7xl font-semibold tabular-nums">
              {state.answered}
              <span className="text-4xl text-muted-foreground">/{state.players}</span>
            </p>
            <p className="text-xl text-muted-foreground">answered</p>
          </div>
        </div>
        <div>
          <Button variant="outline" size="xl" disabled={pending} onClick={() => act(() => closeClassRushQuestionAction(rushId))}>
            Show the answer now
          </Button>
        </div>
      </Screen>
    );
  }

  if (state.phase === "REVEAL") {
    const next = secondsLeft((state.closedAt ?? 0) + state.revealMs, serverNow);
    const last = state.position + 1 >= state.total;
    return (
      <Screen>
        {header}
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div className="flex flex-col gap-4">
            <p className="text-2xl text-muted-foreground">
              Question {state.position + 1} of {state.total}
            </p>
            {state.question?.answerLabel && (
              <p className="font-heading text-6xl font-semibold">
                Answer: <span className="text-primary dark:text-marker">{state.question.answerLabel}</span>
              </p>
            )}
            {state.question?.correct !== null && state.question?.correct !== undefined && (
              <p className="text-2xl">
                <span className="font-semibold tabular-nums">{state.question.correct}</span> of {state.answered} got it right
              </p>
            )}
            <p className="text-xl text-muted-foreground">{last ? `Final results in ${next}…` : `Next question in ${next}…`}</p>
          </div>
          <Leaderboard leaders={state.leaders ?? []} />
        </div>
      </Screen>
    );
  }

  // FINISHED
  const podium = (state.leaders ?? []).slice(0, 3);
  return (
    <Screen>
      {header}
      <h1 className="text-display sm:text-display-lg">Final results</h1>
      <ol className="grid gap-4 sm:grid-cols-3">
        {podium.map((p, i) => (
          <li
            key={`${i}-${p.name}`}
            className={cn(
              "flex flex-col gap-1 rounded-3xl p-6",
              i === 0 ? "bg-achievement/20 text-achievement-foreground dark:text-achievement" : "bg-surface-tint",
            )}
          >
            <span className="font-heading text-2xl font-semibold tabular-nums">#{p.place}</span>
            <span className="text-3xl font-semibold text-foreground">{p.name}</span>
            <span className="text-2xl tabular-nums text-foreground/80">{p.score.toLocaleString()} pts</span>
          </li>
        ))}
      </ol>
      {state.roster.length > 3 && (
        <ol className="divide-y divide-border rounded-2xl border border-border">
          {state.roster.slice(3).map((p, i) => (
            <li key={`${i}-${p.name}`} className="flex items-center justify-between gap-4 px-5 py-3 text-lg">
              <span>
                <span className="mr-3 tabular-nums text-muted-foreground">#{p.place}</span>
                {p.name}
              </span>
              <span className="tabular-nums">{p.score.toLocaleString()}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="flex flex-wrap gap-3">
        <form action={createClassRushAction}>
          <input type="hidden" name="classroomId" value={state.classroomId} />
          <input type="hidden" name="section" value={state.section} />
          <input type="hidden" name="size" value={String(state.total)} />
          <Button type="submit" size="cta">
            Play again
          </Button>
        </form>
        <Link href={`/teacher/classes/${state.classroomId}`} className="inline-flex h-12 items-center rounded-full px-6 text-base font-medium hover:bg-muted">
          Back to the class
        </Link>
      </div>
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-10 sm:py-10">{children}</div>;
}

function Leaderboard({ leaders }: { leaders: { name: string; score: number; place: number }[] }) {
  if (leaders.length === 0) return null;
  return (
    <section aria-label="Leaderboard" className="rounded-3xl border border-border">
      <h2 className="border-b border-border px-6 py-4 text-2xl">Leaderboard</h2>
      <ol className="divide-y divide-border">
        {leaders.map((p, i) => (
          <li key={`${i}-${p.name}`} className="flex items-center justify-between gap-4 px-6 py-3 text-xl">
            <span>
              <span className="mr-3 inline-block w-8 font-heading font-semibold tabular-nums text-muted-foreground">{p.place}</span>
              {p.name}
            </span>
            <span className="font-heading font-semibold tabular-nums">{p.score.toLocaleString()}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
