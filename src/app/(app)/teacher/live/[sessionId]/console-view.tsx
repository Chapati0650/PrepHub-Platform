"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { LogoMark } from "@/components/logo";
import { LatexText } from "@/components/content/latex-text";
import { StudentScreenPreview } from "@/components/guided/student-preview";
import { StatusChip } from "@/components/staff/staff-ui";
import { formatClock, useCountdown } from "@/components/guided/use-shared-state";
import { CONSOLE_POLL_MS, EXTRA_TIME_LABELS } from "@/lib/guided/config";
import type { ConsoleState, ConsoleStudent } from "@/lib/guided/console";
import type { GuidedCommand } from "@/lib/guided/control";
import { scriptFor } from "@/lib/guided/script";
import type { AnswerBreakdown } from "@/lib/teacher/answer-stats";
import { commandAction } from "../actions";

const PHASE_LABELS: Record<ConsoleState["phase"], string> = {
  LOBBY: "Students joining · warm-up",
  PLAN: "Today's plan",
  EXAMPLE: "Worked example",
  THINK: "Thinking alone",
  TALK: "Partner talk",
  REVOTE: "Second vote",
  REVEAL: "The answer",
  EXPLAIN: "Explaining",
  OWN: "On their own",
  RECAP: "Recap",
};

const STATE_WORDS: Record<ConsoleStudent["state"], string> = {
  NOT_HERE: "Not here yet",
  PAPER: "On paper",
  AWAY: "Away",
  ANSWERED: "Answered",
  WORKING: "Working",
  DONE: "Done",
};

const LETTERS = ["A", "B", "C", "D"];

/**
 * The teacher's own screen during a session. It names students, so it is
 * never what goes on the projector: "Open the board" puts the board in its
 * own window for that.
 *
 * Every button is one command; the server claims it against the session's
 * version, so a double click does nothing twice. The screen polls every two
 * seconds and right after each command.
 */
export function ConsoleView({ initial }: { initial: ConsoleState }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [skew, setSkew] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [entering, setEntering] = useState<string | null>(null);
  const pollNow = useRef<() => void>(() => {});

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    async function poll() {
      if (stopped || running) return;
      running = true;
      try {
        const res = await fetch(`/api/guided/console/${initial.sessionId}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as ConsoleState;
          if (!stopped) {
            setState(next);
            setSkew(next.serverNow - Date.now());
            setOffline(false);
          }
        } else if (!stopped) setOffline(true);
      } catch {
        if (!stopped) setOffline(true);
      } finally {
        running = false;
        if (!stopped) timer = setTimeout(poll, CONSOLE_POLL_MS);
      }
    }
    pollNow.current = () => {
      if (timer) clearTimeout(timer);
      void poll();
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [initial.sessionId]);

  const ended = state.status === "ENDED";
  useEffect(() => {
    if (ended) router.push(`/teacher/classes/${state.classroomId}/live/${state.sessionId}`);
  }, [ended, router, state.classroomId, state.sessionId]);

  async function send(command: GuidedCommand) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await commandAction(state.sessionId, command);
      if (!r.ok) setError(r.error);
      else setError(null);
    } catch {
      setError("That didn't reach PrepHub. Check the connection and press it again.");
    } finally {
      setBusy(false);
      pollNow.current();
    }
  }

  // Arrow keys step the example and explanation; a presentation clicker sends them too.
  const live = useRef({ state, send });
  useEffect(() => {
    live.current = { state, send };
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const { state: s, send: go } = live.current;
      if (s.phase !== "EXAMPLE" && s.phase !== "EXPLAIN") return;
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        void go({ type: "STEP", delta: 1 });
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        void go({ type: "STEP", delta: -1 });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const clock = useCountdown(state.phaseEndsAt, skew);
  const voteOpen =
    (state.phase === "LOBBY" || state.phase === "THINK" || state.phase === "TALK" || state.phase === "REVOTE") &&
    state.item?.first.kind === "choices";
  const enteringStudent = state.roster.find((s) => s.studentId === entering) ?? null;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-6">
        <LogoMark className="size-6 text-primary" />
        <span className="font-semibold">{state.className} · Guided Session</span>
        <span className="text-muted-foreground">
          {state.categoryLabel} · {PHASE_LABELS[state.phase]}
          {state.classQuestionNumber ? ` · Question ${state.classQuestionNumber} of ${state.classQuestionCount}` : ""}
        </span>
        <span className="flex-1" />
        {clock !== null && (
          <span className={`rounded-full border px-3 py-1 font-mono text-base tabular-nums ${clock === 0 ? "border-amber-500 text-amber-700 dark:text-amber-300" : "border-border"}`}>
            {clock === 0 ? "Time's up" : `${formatClock(clock)} left`}
          </span>
        )}
        <Link
          href={`/teacher/live/${state.sessionId}/board`}
          target="_blank"
          rel="noopener"
          className="inline-flex h-11 items-center rounded-md border border-border px-4 text-base font-medium hover:bg-muted"
        >
          Open the board
        </Link>
        <Button size="xl" variant="outline" onClick={() => send({ type: "PAUSE", paused: !state.paused })} aria-pressed={state.paused}>
          {state.paused ? "Resume screens" : "Pause screens"}
        </Button>
        <ConfirmButton
          size="xl"
          title="End the session?"
          description="Every screen moves to the student's recap now, and you'll see the report. Students who were absent get a catch-up on their home page for two weeks. A session can't be reopened."
          confirmLabel="End the session"
          onConfirm={() => send({ type: "END" })}
        >
          End session
        </ConfirmButton>
      </div>

      {(error || offline) && (
        <div className="px-4 pt-4 sm:px-6">
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-base text-destructive">
            {offline ? "Reconnecting to PrepHub. The board and students' screens keep going." : error}
          </p>
        </div>
      )}

      <div className="grid flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="flex flex-col gap-5 border-b border-border p-4 sm:p-6 lg:border-r lg:border-b-0">
          <NextMove state={state} busy={busy} send={send} />
          {state.phase === "LOBBY" && (
            <div className="rounded-2xl border border-border p-4">
              <p className="text-base text-muted-foreground">Students join at prephubtp.com/live with</p>
              <p className="mt-1 font-mono text-3xl font-semibold tracking-widest">{state.joinCode}</p>
              <p className="mt-2 text-base">
                <span className="font-semibold tabular-nums">{state.joined}</span> of {state.roster.length} here
              </p>
            </div>
          )}
          {state.item && state.item.kind !== "EXAMPLE" && (state.item.first.answered > 0 || voteOpen) && (
            <VotePanel state={state} />
          )}
          {state.phase === "OWN" && (
            <p className="text-lg">
              <span className="font-semibold tabular-nums">{state.ownFinished}</span> of {state.joined} finished their own
              questions.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-6 p-4 sm:p-6">
          <section aria-labelledby="student-screens" className="rounded-2xl border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h2 id="student-screens" className="text-lg">
                On students&apos; screens
              </h2>
              <p className="text-sm text-muted-foreground">Exactly what students see right now. Read-only; updates by itself.</p>
            </div>
            <div className="max-h-[30rem] overflow-y-auto p-4" tabIndex={0} aria-label="Preview of the students' screen">
              <StudentScreenPreview shared={state.student} />
            </div>
          </section>
          <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg">The room</h2>
            <p className="text-sm text-muted-foreground">Only on your screen. Names never go to the board.</p>
          </div>
          {voteOpen && (
            <p className="text-sm text-muted-foreground">
              A student answering on paper? Select their name, then the letter they hold up.
            </p>
          )}
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {state.roster.map((s) => (
              <li key={s.studentId}>
                <RosterTile
                  student={s}
                  phase={state.phase}
                  selectable={voteOpen}
                  selected={entering === s.studentId}
                  onSelect={() => setEntering(entering === s.studentId ? null : s.studentId)}
                />
              </li>
            ))}
          </ul>
          {enteringStudent && voteOpen && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface-tint p-4">
              <span className="text-base">
                {enteringStudent.name}&apos;s answer{state.phase === "REVOTE" ? " (second vote)" : ""}:
              </span>
              {LETTERS.map((letter, i) => (
                <Button
                  key={letter}
                  size="xl"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    await send({ type: "ENTER_ANSWER", studentId: enteringStudent.studentId, answer: `#${i}` });
                    setEntering(null);
                  }}
                >
                  {letter}
                </Button>
              ))}
              <Button size="xl" variant="ghost" onClick={() => setEntering(null)}>
                Cancel
              </Button>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NextMove({ state, busy, send }: { state: ConsoleState; busy: boolean; send: (c: GuidedCommand) => Promise<void> }) {
  const item = state.item;
  const script = scriptFor({
    phase: state.phase,
    kind: item?.kind ?? null,
    skill: state.categoryLabel,
    suggestion: item?.suggestion ?? null,
    firstRight: item?.firstRight ?? null,
    hasNextQuestion: state.hasNextQuestion,
    step: state.step,
    steps: item?.steps ?? [],
    takeaway: item?.takeaway ?? null,
    correctLabel: item?.correctLabel ?? null,
    correctText: item?.correctText ?? null,
    commonWrong: item?.commonWrong ?? null,
    takeaways: state.student?.recap?.takeaways ?? [],
  });

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-surface-tint p-5">
      <p className="font-mono text-xs tracking-wider text-muted-foreground uppercase">Next move</p>
      <p className="text-xl font-semibold">{script.title}</p>

      {script.doThis.length > 0 && (
        <div>
          <p className="text-base font-semibold">What to do</p>
          <ol className="mt-1 list-decimal space-y-1.5 pl-6 text-base text-foreground/90">
            {script.doThis.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </div>
      )}

      {script.say.length > 0 && (
        <div>
          <p className="text-base font-semibold">What to say</p>
          {script.say.map((line) => (
            <p key={line} className="mt-1 border-l-4 border-primary/50 pl-3 text-base">
              &ldquo;{line}&rdquo;
            </p>
          ))}
        </div>
      )}

      {script.readAloud.map((block) => (
        <div key={block.heading} className="rounded-xl border border-border bg-background p-4">
          <p className="text-base font-semibold">{block.heading}</p>
          <div className="mt-2 flex flex-col gap-2">
            {block.lines.map((line, i) => (
              <p key={i} className="text-base leading-relaxed">
                <LatexText text={line} />
              </p>
            ))}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        {script.primary && (
          <Button size="xl" disabled={busy} onClick={() => void send(script.primary!.command)}>
            {script.primary.label}
          </Button>
        )}
        {script.secondary.map((a) => (
          <Button key={a.label} size="xl" variant="outline" disabled={busy} onClick={() => void send(a.command)}>
            {a.label}
          </Button>
        ))}
      </div>
      {state.phase !== "LOBBY" && state.phase !== "OWN" && state.phase !== "RECAP" && (
        <button type="button" className="w-fit text-sm text-muted-foreground underline underline-offset-2" onClick={() => void send({ type: "OWN" })}>
          Skip ahead to the students&apos; own questions
        </button>
      )}
    </div>
  );
}

function Bars({ breakdown, correctLabel }: { breakdown: AnswerBreakdown; correctLabel: string }) {
  if (breakdown.kind === "entries") {
    return (
      <p className="text-base">
        <span className="font-semibold">{breakdown.correctCount}</span> entered {correctLabel}
        {breakdown.wrong.length > 0 && <> · wrong: {breakdown.wrong.map((w) => `${w.value} (${w.count})`).join(", ")}</>}
      </p>
    );
  }
  const max = Math.max(1, ...breakdown.choices.map((c) => c.count));
  return (
    <div className="flex flex-col gap-1.5">
      {breakdown.choices.map((c) => (
        <div key={c.label} className="grid grid-cols-[1.5rem_1fr_4.5rem] items-center gap-2 text-base">
          <span className="font-semibold">{c.label}</span>
          <span className="h-3 overflow-hidden rounded bg-foreground/10" aria-hidden>
            <span className={`block h-full rounded ${c.correct ? "bg-primary" : "bg-foreground/30"}`} style={{ width: `${(c.count / max) * 100}%` }} />
          </span>
          <span className="tabular-nums">
            {c.count}
            {c.correct && <span className="ml-1 text-sm text-primary">right</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function VotePanel({ state }: { state: ConsoleState }) {
  const item = state.item!;
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
          {item.label} · first vote · only you see this
        </p>
        <p className="mt-1 text-base">
          <span className="font-semibold tabular-nums">{item.first.answered}</span> answered ·{" "}
          <span className="font-semibold tabular-nums">{pct(item.firstRight)}</span> right · answer {item.correctLabel}
          {item.plannedChance !== null && <span className="text-muted-foreground"> · PrepHub expected about {pct(item.plannedChance)}</span>}
        </p>
      </div>
      <Bars breakdown={item.first} correctLabel={item.correctLabel} />
      {item.second && (
        <>
          <p className="font-mono text-xs tracking-wider text-muted-foreground uppercase">After talking · {item.second.answered} answered</p>
          <Bars breakdown={item.second} correctLabel={item.correctLabel} />
        </>
      )}
      {item.kind !== "WARMUP" && (
        <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-border text-center">
          {(
            [
              ["SURE", "sure"],
              ["THINK_SO", "think so"],
              ["GUESSING", "guessing"],
            ] as const
          ).map(([k, label], i) => (
            <div key={k} className={`p-2 ${i > 0 ? "border-l border-border" : ""}`}>
              <p className="text-xl font-semibold tabular-nums">{item.confidence[k]}</p>
              <p className="text-sm text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      )}
      {item.sureWrong > 0 && (
        <p className="text-base">
          <span className="font-semibold">
            {item.sureWrong} student{item.sureWrong === 1 ? " is" : "s are"} sure of a wrong answer.
          </span>{" "}
          <span className="text-muted-foreground">Confident mistakes are the easiest to correct: worth listening for.</span>
        </p>
      )}
    </div>
  );
}

function RosterTile({
  student,
  phase,
  selectable,
  selected,
  onSelect,
}: {
  student: ConsoleStudent;
  phase: ConsoleState["phase"];
  selectable: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const own = student.own;
  const answer = student.second ?? student.first;
  const answerCorrect = student.second !== null ? student.secondCorrect : student.firstCorrect;
  const detail =
    phase === "OWN" || phase === "RECAP"
      ? own
        ? `${own.answered} of ${own.total} · ${own.right} right`
        : STATE_WORDS[student.state]
      : answer
        ? `${answer}${student.second !== null && student.first !== student.second ? ` (was ${student.first})` : ""}${student.confidence ? ` · ${student.confidence === "SURE" ? "sure" : student.confidence === "THINK_SO" ? "think so" : "guessing"}` : ""}`
        : STATE_WORDS[student.state];
  const tone =
    student.state === "NOT_HERE" || student.state === "AWAY"
      ? "bg-muted/60"
      : student.extraTime !== "NONE" && student.state === "WORKING"
        ? "border-primary bg-primary/5"
        : "";
  const content = (
    <>
      <span className="block truncate text-base font-semibold">{student.name}</span>
      <span className="block truncate text-sm text-muted-foreground">
        {answer && phase !== "OWN" && phase !== "RECAP" && (
          <span className={answerCorrect === false ? "font-semibold text-destructive" : answerCorrect ? "font-semibold text-green-800 dark:text-green-300" : ""}>
            {answerCorrect === false ? "✗ " : answerCorrect ? "✓ " : ""}
          </span>
        )}
        {detail}
      </span>
      <span className="mt-1 flex flex-wrap gap-1">
        {student.state === "AWAY" && <StatusChip tone="warn">Away</StatusChip>}
        {student.state === "PAPER" && detail !== STATE_WORDS.PAPER && <StatusChip tone="muted">On paper</StatusChip>}
        {student.extraTime !== "NONE" && <StatusChip tone="muted">{EXTRA_TIME_LABELS[student.extraTime]}</StatusChip>}
        {student.veryFast && <StatusChip tone="warn">Very fast</StatusChip>}
      </span>
    </>
  );
  const className = `block w-full min-w-0 rounded-xl border p-3 text-left ${tone} ${selected ? "ring-2 ring-primary" : ""}`;
  return selectable ? (
    <button type="button" className={className} onClick={onSelect} aria-pressed={selected}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
