"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { isStaleServerActionError } from "@/lib/stale-build";
import type { ClassRushAnswerResult, ClassRushMe, ClassRushQuestion, ClassRushShared } from "@/lib/rush/class-rush";
import { RushQuestion, TimeBar } from "../../rush-question";
import { classRushMeAction, classRushQuestionAction, submitClassRushAnswerAction, type ClassRushProblem } from "../actions";

const POLL_MS = 1_000;

function isProblem<T extends object>(x: T | ClassRushProblem): x is ClassRushProblem {
  return "problem" in x;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

/**
 * A student's Class Rush screen (2026-11-15). It polls the game's cached
 * shared state once a second and asks the server for its own score and the
 * question only when the game moves, so a class of thirty is cheap to run.
 * The clock is the server's: every countdown here is drawn from the shared
 * open time, and the server times the answer.
 */
export function ClassRushPlay({ rushId, stateKey }: { rushId: string; stateKey: string }) {
  const [shared, setShared] = useState<ClassRushShared | null>(null);
  const [me, setMe] = useState<ClassRushMe | null>(null);
  const [question, setQuestion] = useState<ClassRushQuestion | null>(null);
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<ClassRushAnswerResult | null>(null);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // The server's clock minus this one, so every countdown here is the room's.
  const [offset, setOffset] = useState(0);
  const seenVersion = useRef(-1);
  const questionFor = useRef(-1);
  const answerFetchedFor = useRef(-1);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    async function loadQuestion(position: number, reveal: boolean) {
      try {
        const q = await classRushQuestionAction(rushId);
        if (cancelled || isProblem(q)) return;
        setQuestion(q);
        if (q.position !== questionFor.current) {
          questionFor.current = q.position;
          setDraft("");
          setResult(null);
          setProblem(null);
        }
        if (reveal) answerFetchedFor.current = position;
      } catch (err) {
        if (isStaleServerActionError(err)) setStale(true);
      }
    }

    async function poll() {
      let next: ClassRushShared | null = null;
      try {
        const res = await fetch(`/api/class-rush/state/${stateKey}`);
        if (res.ok) next = (await res.json()) as ClassRushShared;
      } catch {
        // A dropped request: keep the last state.
      }
      if (cancelled) return;
      if (next) {
        setOffset(next.serverNow - Date.now());
        setShared(next);
        if (next.v !== seenVersion.current) {
          seenVersion.current = next.v;
          classRushMeAction(rushId)
            .then((m) => {
              if (!cancelled && !isProblem(m)) setMe(m);
            })
            .catch((err) => {
              if (isStaleServerActionError(err)) setStale(true);
            });
        }
        if ((next.phase === "QUESTION" || next.phase === "REVEAL") && questionFor.current !== next.position) {
          await loadQuestion(next.position, next.phase === "REVEAL");
        } else if (next.phase === "REVEAL" && answerFetchedFor.current !== next.position) {
          // The question's answer arrives with it once it has closed.
          await loadQuestion(next.position, true);
        }
      }
      if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
    }

    timer = window.setTimeout(poll, 0);
    const clock = window.setInterval(() => setNow(Date.now()), 200);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        window.clearTimeout(timer);
        timer = window.setTimeout(poll, 0);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [rushId, stateKey]);

  const serverNow = now + offset;
  const phase = shared?.phase ?? "LOBBY";
  const position = shared?.position ?? 0;
  const deadline = shared?.openedAt ? shared.openedAt + shared.limitMs : 0;
  const remainingMs = Math.max(0, deadline - serverNow);
  const onQuestion = phase === "QUESTION" && question?.position === position;
  const answered = result !== null || (me?.answer?.position === position && me.answer !== null);
  const mine = result ?? (me?.answer?.position === position ? me.answer : null);

  async function submit(answer: string) {
    if (!question || sending || answered) return;
    setSending(true);
    setProblem(null);
    try {
      const r = await submitClassRushAnswerAction(rushId, question.position, answer);
      if (isProblem(r)) setProblem(r.problem === "OVER" ? "Time was up for that one." : r.message);
      else setResult(r);
    } catch (err) {
      if (isStaleServerActionError(err)) setStale(true);
      else setProblem("Your answer didn't reach PrepHub. Check your connection, then press Submit again.");
    } finally {
      setSending(false);
    }
  }

  // Whatever is chosen when the clock runs out is the answer, like every Rush.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });
  const buzzer = onQuestion && !answered && remainingMs === 0;
  useEffect(() => {
    if (buzzer && draftRef.current) void submitRef.current(draftRef.current);
  }, [buzzer]);

  if (stale) {
    return (
      <Frame>
        <h1 className="text-display-sm">PrepHub was just updated.</h1>
        <p className="text-lg text-muted-foreground">Reload to get back into the game; your points are kept.</p>
        <div>
          <Button size="cta" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </Frame>
    );
  }

  if (!shared) {
    return (
      <Frame>
        <p className="text-lg text-muted-foreground">Joining the game…</p>
      </Frame>
    );
  }

  const scoreLine = me ? `${me.score.toLocaleString()} points · ${ordinal(me.place)} of ${me.players}` : null;

  if (phase === "LOBBY") {
    return (
      <Frame>
        <p className="text-base font-medium text-muted-foreground">
          Class Rush · {shared.className} · {shared.sectionLabel}
        </p>
        <h1 className="text-display-sm sm:text-display">You&apos;re in!</h1>
        <p className="text-xl text-foreground/80">
          {shared.teacherName} will start the game. {shared.players} {shared.players === 1 ? "player is" : "players are"} in so far.
        </p>
        <p className="text-lg text-muted-foreground">
          {shared.total} questions. Points for being right, more for being fast, and a bonus for a streak.
        </p>
      </Frame>
    );
  }

  if (phase === "COUNTDOWN") {
    const s = Math.max(0, Math.ceil(((shared.openedAt ?? 0) - serverNow) / 1000));
    return (
      <Frame center>
        <p className="text-2xl text-muted-foreground">{position === 0 ? "Get ready" : `Question ${position + 1} of ${shared.total}`}</p>
        <p className="font-heading text-[8rem] leading-none font-semibold tabular-nums" aria-live="assertive">
          {s > 0 ? s : "Go!"}
        </p>
      </Frame>
    );
  }

  if (phase === "FINISHED") {
    return (
      <Frame>
        <p className="text-base font-medium text-muted-foreground">Class Rush · {shared.className}</p>
        <h1 className="text-display-sm sm:text-display">{me ? `You finished ${ordinal(me.place)} of ${me.players}` : "Game over"}</h1>
        {me && (
          <p className="text-2xl">
            <span className="font-heading font-semibold tabular-nums">{me.score.toLocaleString()}</span> points · {me.correct} of {shared.total} right
          </p>
        )}
        <Leaders leaders={shared.leaders ?? []} />
        <div>
          <LinkButton href="/rush" size="cta">
            Back to 1v1 Rush
          </LinkButton>
        </div>
      </Frame>
    );
  }

  // QUESTION or REVEAL
  const reveal = phase === "REVEAL";
  const next = Math.max(0, Math.ceil(((shared.closedAt ?? 0) + shared.revealMs - serverNow) / 1000));
  return (
    <div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-4 px-4 py-4 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3 text-base">
        <span className="font-medium">
          Question {position + 1} of {shared.total} · {shared.sectionLabel}
        </span>
        {scoreLine && !reveal && <span className="tabular-nums text-muted-foreground">{scoreLine}</span>}
      </div>
      {!reveal && <TimeBar remainingMs={remainingMs} limitMs={shared.limitMs} frozen={answered} right={`${shared.answered} of ${shared.players} answered`} />}

      {reveal && (
        <div className="flex flex-col gap-3 rounded-2xl bg-surface-tint p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xl font-medium" role="status">
            {mine ? (mine.isCorrect ? `Right! +${mine.points}` : "Not this time.") : "No answer this time."}{" "}
            <span className="font-normal text-muted-foreground">{position + 1 >= shared.total ? `Final results in ${next}…` : `Next question in ${next}…`}</span>
          </p>
          {scoreLine && <p className="text-lg tabular-nums">{scoreLine}</p>}
        </div>
      )}

      {question && question.position === position ? (
        <RushQuestion
          content={question.content}
          draft={draft}
          answered={answered || reveal}
          correctChoiceId={reveal ? question.correctChoiceId : null}
          onDraftChange={setDraft}
          onAnswer={(a) => void submit(a)}
          feedback={mine ? (mine.isCorrect ? "correct" : "wrong") : null}
          scratchKey={`class-rush:${rushId}:${position}`}
        />
      ) : (
        <p className="text-lg text-muted-foreground">Loading the question…</p>
      )}

      {!reveal && mine && (
        <p className="text-xl font-medium" role="status">
          {mine.isCorrect ? `Right! +${mine.points}${mine.streak >= 2 ? ` · ${mine.streak} in a row` : ""}` : "Not this time."}{" "}
          <span className="font-normal text-muted-foreground">Waiting for the class: {shared.answered} of {shared.players} answered.</span>
        </p>
      )}
      {reveal && question?.acceptedAnswer && !question.correctChoiceId && (
        <p className="text-lg">
          The answer: <span className="font-semibold">{question.acceptedAnswer}</span>
        </p>
      )}
      {problem && (
        <p className="text-base text-destructive" role="alert">
          {problem}
        </p>
      )}
      {reveal && <Leaders leaders={(shared.leaders ?? []).slice(0, 5)} />}
    </div>
  );
}

function Frame({ children, center = false }: { children: React.ReactNode; center?: boolean }) {
  return (
    <div className={center ? "mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 py-16 text-center" : "mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-10 sm:px-8"}>
      {children}
    </div>
  );
}

function Leaders({ leaders }: { leaders: { name: string; score: number; place: number }[] }) {
  if (leaders.length === 0) return null;
  return (
    <ol className="divide-y divide-border rounded-2xl border border-border" aria-label="Leaderboard">
      {leaders.map((p, i) => (
        <li key={`${i}-${p.name}`} className="flex items-center justify-between gap-4 px-5 py-2.5 text-lg">
          <span>
            <span className="mr-3 inline-block w-6 tabular-nums text-muted-foreground">{p.place}</span>
            {p.name}
          </span>
          <span className="font-heading font-semibold tabular-nums">{p.score.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}
