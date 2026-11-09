"use client";

import { useEffect, useState } from "react";
import { LogoMark } from "@/components/logo";
import { LatexText } from "@/components/content/latex-text";
import { QuestionStatement } from "@/components/content/question-statement";
import { formatClock, useCountdown, useSharedState } from "@/components/guided/use-shared-state";
import { TALK_FROM } from "@/lib/guided/config";
import type { SharedItem, SharedState } from "@/lib/guided/state";

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/**
 * The projector. Large type, one thing at a time, and the same words the
 * students' screens use. Built only from the shared state, which has no
 * student in it.
 */
export function BoardView({ stateKey, initial }: { stateKey: string; initial: SharedState | null }) {
  const { state, offline, skew } = useSharedState(stateKey, initial);
  const clock = useCountdown(state?.phaseEndsAt ?? null, skew);
  if (!state) return <p className="p-10 text-3xl">This session isn&apos;t available.</p>;

  const item = state.item;
  return (
    <div className="flex flex-1 flex-col bg-background">
      <div className="flex items-center gap-4 px-8 py-5 text-xl text-muted-foreground">
        <LogoMark className="size-9 text-primary" />
        <span className="font-brand text-2xl font-semibold text-foreground">PrepHub</span>
        <span>
          Guided Session · {state.className} · {state.categoryLabel}
        </span>
        <span className="flex-1" />
        {state.paused && <span className="rounded-full bg-amber-100 px-4 py-1 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">Screens paused</span>}
        {offline && <span className="text-base">Reconnecting…</span>}
        <FullScreenButton />
        {clock !== null && state.phase !== "OWN" && (
          <span className="rounded-full border-2 border-border px-5 py-1 font-mono text-3xl tabular-nums text-foreground">
            {clock === 0 ? "Time's up" : formatClock(clock)}
          </span>
        )}
      </div>
      <main className="flex flex-1 flex-col gap-8 px-8 pb-10 lg:px-14">
        <Body state={state} item={item} clock={clock} />
      </main>
    </div>
  );
}

function Body({ state, item, clock }: { state: SharedState; item: SharedItem | null; clock: number | null }) {
  if (state.status === "ENDED") {
    return (
      <Center>
        <h1 className="text-6xl font-semibold tracking-tight">Thanks, {state.className}.</h1>
        <p className="text-3xl text-muted-foreground">Absent today? A catch-up is on your PrepHub home page.</p>
      </Center>
    );
  }

  switch (state.phase) {
    case "LOBBY":
      return (
        <div className="flex flex-1 flex-col justify-center gap-10">
          <h1 className="text-6xl font-semibold tracking-tight">Join today&apos;s Guided Session</h1>
          <div className="grid gap-10 md:grid-cols-[1.4fr_1fr]">
            <div>
              <p className="text-2xl text-muted-foreground">Go to</p>
              <p className="text-6xl font-semibold tracking-tight">prephubtp.com/live</p>
            </div>
            <div>
              <p className="text-2xl text-muted-foreground">Code</p>
              <p className="font-mono text-7xl font-semibold tracking-[0.15em]">{state.joinCode}</p>
            </div>
          </div>
          <p className="text-2xl text-muted-foreground">
            Already in {state.className}? It&apos;s on your PrepHub home page. Just press Join.
            {item && " The warm-up is on your screen as soon as you're in."}
          </p>
          <p className="text-4xl">
            <span className="font-mono font-semibold tabular-nums">{state.joined}</span> of {state.rosterSize} here
          </p>
        </div>
      );
    case "PLAN":
      return (
        <div className="flex flex-1 flex-col justify-center gap-10">
          <div>
            <p className="font-mono text-2xl tracking-wider text-primary uppercase">Today</p>
            <h1 className="text-6xl font-semibold tracking-tight">{state.categoryLabel}</h1>
          </div>
          <ol className="grid gap-6 text-3xl md:grid-cols-4">
            {[
              ["Watch an example", "about 4 min"],
              [`${state.classQuestionCount} questions together`, "about 13 min"],
              [`${state.ownQuestionCount} on your own`, `${Math.round(state.ownSeconds / 60)} min`],
              ["Recap", "3 min"],
            ].map(([what, when], i) => (
              <li key={what} className={`border-t-4 pt-3 ${i === 0 ? "border-primary" : "border-border"}`}>
                <span className="block font-medium">{what}</span>
                <span className="font-mono text-xl text-muted-foreground">{when}</span>
              </li>
            ))}
          </ol>
          <p className="rounded-2xl bg-surface-tint p-6 text-3xl">
            Chosen for this class: <span className="font-semibold">the skill where the most of you have points to gain.</span>
          </p>
        </div>
      );
    case "EXAMPLE":
    case "EXPLAIN":
      if (!item) return null;
      return (
        <div className="flex flex-col gap-6">
          <p className="font-mono text-2xl tracking-wider text-primary uppercase">
            {state.phase === "EXAMPLE" ? "Worked example" : `${item.label} · explanation`}
            {item.stepTotal > 0 && ` · step ${Math.min(state.step + 1, item.stepTotal)} of ${item.stepTotal}`}
          </p>
          {/* Compact once the steps start, and the newest step scrolled into view: at 1920x1080 the sixth
              step of an example ran off the bottom of the projector (review, 2026-11-09). */}
          <BoardQuestion item={item} compact={state.phase === "EXPLAIN" || state.step > 0} />
          {item.steps && (
            <ol className="flex flex-col gap-3">
              {item.steps.map((s, i) => (
                <li
                  key={i}
                  id={i === item.steps!.length - 1 ? "board-current-step" : undefined}
                  className={`flex scroll-mb-8 gap-5 rounded-2xl p-5 text-3xl leading-snug ${i === item.steps!.length - 1 ? "bg-primary/10 ring-2 ring-primary/50" : ""}`}
                >
                  <span className="w-8 shrink-0 font-mono text-2xl text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0">
                    <LatexText text={s.text} />
                    {s.imageId && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/media/${s.imageId}`} alt="" className="mt-3 max-h-80 rounded" />
                    )}
                  </span>
                </li>
              ))}
              <ScrollToCurrentStep step={item.steps.length} />
              {item.steps.length < item.stepTotal && (
                <li className="pl-14 text-2xl text-muted-foreground">
                  {item.stepTotal - item.steps.length} more step{item.stepTotal - item.steps.length === 1 ? "" : "s"}…
                </li>
              )}
            </ol>
          )}
          {state.phase === "EXPLAIN" && item.takeaway && item.steps?.length === item.stepTotal && (
            <p className="rounded-2xl bg-surface-tint p-5 text-3xl">
              <span className="font-semibold text-primary">Remember: </span>
              <LatexText text={item.takeaway} />
            </p>
          )}
        </div>
      );
    case "THINK":
    case "REVOTE":
      if (!item) return null;
      return (
        <div className="flex flex-col gap-8">
          <p className="font-mono text-2xl tracking-wider text-primary uppercase">
            {item.label} · {state.phase === "REVOTE" ? "vote again" : "think on your own"}
          </p>
          <BoardQuestion item={item} />
          <div className="flex flex-wrap items-baseline justify-between gap-6 text-3xl">
            <span>
              <span className="font-mono font-semibold tabular-nums">{state.phase === "REVOTE" ? item.secondAnswered : item.firstAnswered}</span> of{" "}
              {state.joined} answered
            </span>
            <span className="text-2xl text-muted-foreground">
              {clock === 0 ? "Time's up: whatever you've chosen is your answer." : "Answers stay hidden until the room is done."}
            </span>
          </div>
        </div>
      );
    case "TALK":
      if (!item) return null;
      return (
        <div className="grid flex-1 gap-10 lg:grid-cols-2">
          <div className="flex flex-col gap-6">
            <p className="font-mono text-2xl tracking-wider text-primary uppercase">
              {item.label} · {item.firstAnswered} of {state.joined} answered
            </p>
            <BoardQuestion item={item} compact />
          </div>
          <div className="flex flex-col justify-center gap-6">
            <h1 className="text-6xl font-semibold tracking-tight">The room is split. Turn to a partner.</h1>
            <p className="text-3xl">Explain your answer. Try to convince them. Then you&apos;ll vote again.</p>
            <p className="text-2xl text-muted-foreground">How the room voted stays hidden until after the second vote.</p>
          </div>
        </div>
      );
    case "REVEAL":
      if (!item?.reveal) return null;
      return <Reveal item={item} />;
    case "OWN":
      if (state.mode === "INDIVIDUAL") {
        // Individual practice has no class phases: the board is how students join, and how far the
        // room has got, with nothing about any one student.
        return (
          <div className="flex flex-1 flex-col justify-center gap-10">
            <h1 className="text-6xl font-semibold tracking-tight">Practice on your own · {state.ownQuestionCount} questions</h1>
            <div className="grid gap-10 md:grid-cols-[1.4fr_1fr]">
              <div>
                <p className="text-2xl text-muted-foreground">Go to</p>
                <p className="text-6xl font-semibold tracking-tight">prephubtp.com/live</p>
              </div>
              <div>
                <p className="text-2xl text-muted-foreground">Code</p>
                <p className="font-mono text-7xl font-semibold tracking-[0.15em]">{state.joinCode}</p>
              </div>
            </div>
            <p className="text-3xl">Everyone gets their own questions, picked for them. Each answer is explained on your screen.</p>
            <p className="text-4xl">
              <span className="font-mono font-semibold tabular-nums">{state.joined}</span> here ·{" "}
              <span className="font-mono font-semibold tabular-nums">{state.ownFinished}</span> finished
            </p>
          </div>
        );
      }
      return (
        <Center>
          <p className="font-mono text-3xl tracking-wider text-primary uppercase">On your own · {state.ownQuestionCount} questions</p>
          <p className="font-mono text-[9rem] leading-none font-semibold tabular-nums">{clock === null ? "" : formatClock(clock)}</p>
          <p className="text-4xl">Everyone has different questions: the same skill, at your level.</p>
          <p className="text-3xl text-muted-foreground">
            <span className="font-mono font-semibold tabular-nums text-foreground">{state.ownFinished}</span> of {state.joined} finished ·
            Finished? Try the bonus question, or rest.
          </p>
        </Center>
      );
    case "RECAP":
      return (
        <div className="flex flex-1 flex-col justify-center gap-8">
          <p className="font-mono text-2xl tracking-wider text-primary uppercase">Today · {state.categoryLabel}</p>
          {state.recap && (
            <>
              <ul className="flex flex-col gap-4 text-4xl">
                {state.recap.questions.map((q) => (
                  <li key={q.label}>
                    <span className="font-semibold">{q.label}:</span> {pct(q.firstRight)}
                    {q.talked && q.secondRight !== null && <> → {pct(q.secondRight)} after talking</>}
                  </li>
                ))}
                {state.recap.ownAverage !== null && (
                  <li>
                    <span className="font-semibold">On your own:</span> {state.recap.ownAverage.toFixed(1)} of {state.recap.ownTotal}, on average
                  </li>
                )}
              </ul>
              {state.recap.takeaways.map((k) => (
                <p key={k} className="rounded-2xl bg-surface-tint p-5 text-3xl">
                  <span className="font-semibold text-primary">Remember: </span>
                  <LatexText text={k} />
                </p>
              ))}
            </>
          )}
        </div>
      );
  }
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col justify-center gap-6">{children}</div>;
}

function BoardQuestion({ item, compact = false }: { item: SharedItem; compact?: boolean }) {
  const c = item.content;
  const text = compact ? "text-2xl leading-snug" : "text-4xl leading-snug";
  const question = (
    <div className="flex min-w-0 flex-col gap-6">
      <QuestionStatement text={c.questionText} imageId={c.questionImageId} mediaBasePath="/api/media" className="bg-transparent p-0" textClassName={text} />
      {c.questionType === "MULTIPLE_CHOICE" && (
        <ol className={`grid gap-x-10 gap-y-3 md:grid-cols-2 ${compact ? "text-2xl" : "text-3xl"}`}>
          {c.answerChoices.map((choice, i) => (
            <li key={choice.id} className="flex items-start gap-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-foreground/40 text-2xl font-semibold">
                {LETTERS[i]}
              </span>
              <span className="min-w-0 pt-1">
                <LatexText text={choice.text} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
  if (!c.passageText) return question;
  if (compact) {
    // Talk, reveal and explanation: the passage stays (a "which choice
    // completes the text" question means nothing without it), smaller.
    return (
      <div className="flex flex-col gap-5">
        <QuestionStatement text={c.passageText} imageId={null} mediaBasePath="/api/media" className="rounded-xl bg-muted/40 p-5" textClassName="text-2xl leading-snug" />
        {question}
      </div>
    );
  }
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <QuestionStatement text={c.passageText} imageId={null} mediaBasePath="/api/media" className="bg-transparent p-0 lg:border-r lg:border-foreground/15 lg:pr-10" textClassName="text-3xl leading-snug" />
      {question}
    </div>
  );
}

function Reveal({ item }: { item: SharedItem }) {
  const r = item.reveal!;
  const counts = r.firstCounts;
  const total = (xs: number[] | null) => (xs ? Math.max(1, xs.reduce((a, b) => a + b, 0)) : 1);
  const correctIndex = item.content.answerChoices.findIndex((c) => c.id === r.correctChoiceId);
  const hard = r.firstRight !== null && r.firstRight < TALK_FROM && item.kind === "CLASS";
  return (
    <div className="grid flex-1 gap-10 lg:grid-cols-[1.1fr_1fr]">
      <div className="flex flex-col gap-6">
        <p className="font-mono text-2xl tracking-wider text-primary uppercase">
          {item.label} · {r.firstAnswered} answered
        </p>
        <p className="text-8xl leading-none font-semibold tracking-tight tabular-nums">
          {pct(r.firstRight)}
          {r.secondRight !== null && <> → {pct(r.secondRight)}</>}
        </p>
        <p className="text-3xl text-muted-foreground">
          {r.secondRight !== null ? "right on the first vote → after talking" : "right"} · the answer is {r.correctLabel}
        </p>
        {r.commonWrong && (
          <div className="rounded-2xl bg-surface-tint p-6">
            <p className="text-3xl font-semibold">Most common wrong answer: {r.commonWrong.label}</p>
            {r.commonWrong.note && <LatexText text={r.commonWrong.note} className="mt-2 block text-2xl" />}
          </div>
        )}
        {hard && <p className="text-3xl">Most of the room found this one hard. We&apos;ll work it together.</p>}
      </div>
      <div className="flex flex-col gap-6">
        <BoardQuestion item={item} compact />
        {counts && (
          <div className="flex flex-col gap-3">
            {r.secondCounts && (
              <p className="text-xl text-muted-foreground">
                <span className="mr-2 inline-block h-3 w-8 rounded bg-foreground/25 align-middle" /> first vote
                <span className="mr-2 ml-6 inline-block h-3 w-8 rounded bg-primary align-middle" /> after talking
              </p>
            )}
            {counts.map((n, i) => (
              <div key={i} className="grid grid-cols-[3rem_1fr_7rem] items-center gap-4 text-2xl">
                <span className="font-semibold">{LETTERS[i]}</span>
                <span className="flex flex-col gap-1">
                  <span className="h-5 overflow-hidden rounded bg-foreground/10">
                    <span
                      className={`block h-full rounded ${i === correctIndex && !r.secondCounts ? "bg-primary" : "bg-foreground/25"}`}
                      style={{ width: `${(n / total(counts)) * 100}%` }}
                    />
                  </span>
                  {r.secondCounts && (
                    <span className="h-5 overflow-hidden rounded bg-foreground/10">
                      <span className="block h-full rounded bg-primary" style={{ width: `${(r.secondCounts[i] / total(r.secondCounts)) * 100}%` }} />
                    </span>
                  )}
                </span>
                <span className="font-mono tabular-nums">
                  {r.secondCounts ? `${n} → ${r.secondCounts[i]}` : n}
                  {i === correctIndex && <span className="ml-2 font-sans text-lg text-primary">right</span>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Keeps the step just shown on the projector in view as the example grows. */
function ScrollToCurrentStep({ step }: { step: number }) {
  useEffect(() => {
    document.getElementById("board-current-step")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [step]);
  return null;
}

/** One click to fill the projector; hidden once the board is full screen. */
function FullScreenButton() {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const onChange = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  if (full) return null;
  return (
    <button
      type="button"
      onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})}
      className="rounded-full border border-border px-4 py-1 text-base text-muted-foreground hover:bg-muted"
    >
      Full screen
    </button>
  );
}
