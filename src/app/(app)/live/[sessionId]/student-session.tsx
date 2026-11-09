"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/logo";
import { LatexText } from "@/components/content/latex-text";
import { GuidedQuestion, StepsList, choiceLetter, isRight } from "@/components/guided/question";
import { useGuidedLang } from "@/components/guided/use-lang";
import { formatClock, useCountdown, useSharedState } from "@/components/guided/use-shared-state";
import type { Strings } from "@/components/guided/strings";
import { HEARTBEAT_MS, TALK_FROM } from "@/lib/guided/config";
import type { SharedState } from "@/lib/guided/state";
import type { Feedback, PersonalState, StudentRecap } from "@/lib/guided/student";
import type { ExtraTime, GuidedPhase } from "@/generated/prisma/client";
import {
  bonusAction,
  confidenceAction,
  joinSessionAction,
  myStateAction,
  ownAnswerAction,
  paceAction,
  recapAction,
  saveDraftAction,
  submitAnswerAction,
} from "../actions";

/**
 * A student's screen in a Guided Session. It follows the room: the teacher
 * moves the phase and this screen shows what to do now, in words, every time.
 * Nothing here lets a student get ahead of the room; a question's content
 * arrives only when the teacher opens it.
 */

function openVote(phase: GuidedPhase, extraTime: ExtraTime, firstAnswer: string | null): 1 | 2 | null {
  const extended = extraTime !== "NONE";
  switch (phase) {
    case "LOBBY":
    case "THINK":
      return 1;
    case "TALK":
      return extended && firstAnswer === null ? 1 : null;
    case "REVOTE":
      return extended && firstAnswer === null ? 1 : 2;
    default:
      return null;
  }
}

/** A thrown action is a dropped connection (the server returns its problems as data). */
function useRetrying() {
  const [offline, setOffline] = useState(false);
  async function run<T>(call: () => Promise<T>, tries = 20): Promise<T | null> {
    for (let i = 0; i < tries; i++) {
      try {
        const result = await call();
        setOffline(false);
        return result;
      } catch {
        setOffline(true);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    return null;
  }
  return { offline, run };
}

export function StudentSession({
  sessionId,
  stateKey,
  initialShared,
  initialMine,
}: {
  sessionId: string;
  stateKey: string;
  initialShared: SharedState | null;
  initialMine: PersonalState;
}) {
  const router = useRouter();
  const { t, toggle } = useGuidedLang();
  const { state: shared, offline: pollOffline, skew, refresh } = useSharedState(stateKey, initialShared);
  const [mine, setMine] = useState<PersonalState>(initialMine);
  const { offline: sendOffline, run } = useRetrying();
  const [error, setError] = useState<string | null>(null);

  // The student's own state follows the room: refetched whenever the teacher moves it.
  const roomKey = shared ? `${shared.version}:${shared.phase}:${shared.position}:${shared.status}` : "";
  useEffect(() => {
    if (!roomKey) return;
    let cancelled = false;
    void myStateAction(sessionId).then((r) => {
      if (!cancelled && r.ok) setMine(r.mine);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roomKey, sessionId]);

  // A finished session becomes the recap page.
  const ended = shared?.status === "ENDED";
  useEffect(() => {
    if (ended) router.refresh();
  }, [ended, router]);

  // Presence, for the teacher's "Away".
  const joined = mine.joined;
  useEffect(() => {
    if (!joined) return;
    const send = () => {
      const body = JSON.stringify({ sessionId, hidden: document.visibilityState === "hidden" });
      if (document.visibilityState === "hidden" && navigator.sendBeacon) navigator.sendBeacon("/api/guided/heartbeat", body);
      else void fetch("/api/guided/heartbeat", { method: "POST", body, keepalive: true }).catch(() => {});
    };
    send();
    const id = setInterval(send, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", send);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", send);
    };
  }, [joined, sessionId]);

  const clock = useCountdown(shared?.phaseEndsAt ?? null, skew);
  const extraTime = mine.extraTime !== "NONE";

  if (!shared) {
    return <Shell t={t} toggle={toggle} title={t.guided}><p className="text-lg">{t.movedOn}</p></Shell>;
  }

  const top = (
    <TopBar
      t={t}
      toggle={toggle}
      shared={shared}
      clock={shared.phase === "OWN" ? null : clock}
      extraTime={extraTime && (shared.phase === "THINK" || shared.phase === "TALK" || shared.phase === "REVOTE")}
    />
  );
  const banners = (
    <>
      {(pollOffline || sendOffline) && (
        <p role="status" className="rounded-lg bg-amber-100 p-3 text-base font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          {t.reconnecting}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-base text-destructive">
          {error}
        </p>
      )}
    </>
  );

  if (!mine.joined) {
    return (
      <Frame top={top} banners={banners}>
        <JoinScreen t={t} practice={shared.mode === "INDIVIDUAL"} sessionId={sessionId} onJoined={(m) => { setMine(m); refresh(); }} setError={setError} />
      </Frame>
    );
  }

  if (ended) {
    return (
      <Frame top={top} banners={banners}>
        <p className="text-xl font-semibold">{t.ended}</p>
      </Frame>
    );
  }

  if (shared.paused) {
    return (
      <Frame top={top} banners={banners}>
        <EyesUp t={t} body={t.eyesUpPaused} />
      </Frame>
    );
  }

  const item = shared.item;
  const response = mine.response && item && mine.response.itemId === item.id ? mine.response : null;

  let body: React.ReactNode;
  switch (shared.phase) {
    case "LOBBY":
      body = item ? (
        <VoteStage
          key={`${item.id}:1`}
          t={t}
          shared={shared}
          sessionId={sessionId}
          vote={1}
          response={response}
          label={`${t.warmup} · ${t.youreIn}`}
          hint={t.warmupHint}
          showConfidence={false}
          run={run}
          setError={setError}
          onSent={(r) => setMine((m) => ({ ...m, response: r }))}
        />
      ) : (
        <p className="text-xl">{t.waitingStart}</p>
      );
      break;
    case "PLAN":
      body = <PlanScreen t={t} shared={shared} />;
      break;
    case "EXAMPLE":
      body = item ? (
        <div className="flex flex-col gap-5">
          <EyesUp t={t} body={t.eyesUpExample} />
          <div className="opacity-60">
            <p className="mb-3 font-mono text-xs tracking-wider text-muted-foreground uppercase">{t.exampleTitle}</p>
            <LatexText text={item.content.questionText} className="text-lg" />
            {/* One step behind the board, except at the last step: before, the example's final step never
                reached students before Question 1 started (review, 2026-11-09). */}
            {item.steps && (item.steps.length > 1 || item.steps.length === item.stepTotal) && (
              <StepsList
                steps={item.steps}
                upTo={item.steps.length === item.stepTotal ? item.steps.length - 1 : item.steps.length - 2}
                className="mt-4"
              />
            )}
          </div>
        </div>
      ) : null;
      break;
    case "THINK":
    case "TALK":
    case "REVOTE": {
      if (!item) break;
      const vote = openVote(shared.phase, mine.extraTime, response?.firstAnswer ?? null);
      const late = mine.missedBeforeJoining > 0 && !response?.firstAnswer;
      if (shared.phase === "TALK" && vote === null) {
        body = <TalkScreen t={t} shared={shared} firstAnswer={response?.firstAnswer ?? null} />;
        break;
      }
      body = (
        <div className="flex flex-col gap-4">
          {late && <p className="rounded-lg bg-surface-tint p-3 text-base font-medium">{t.lateBanner}</p>}
          {shared.phase === "TALK" && <p className="rounded-lg bg-surface-tint p-3 text-base font-medium">{t.finishFirst}</p>}
          <VoteStage
            key={`${item.id}:${vote}`}
            t={t}
            shared={shared}
            sessionId={sessionId}
            vote={vote ?? 1}
            response={response}
            label={vote === 2 ? t.voteAgain : t.thinkAlone}
            hint={vote === 2 ? t.keepOrChange : extraTime ? t.noClock : t.draftHint}
            showConfidence={vote === 1}
            run={run}
            setError={setError}
            onSent={(r) => setMine((m) => ({ ...m, response: r }))}
          />
        </div>
      );
      break;
    }
    case "REVEAL":
    case "EXPLAIN":
      body = item?.reveal ? <RevealScreen t={t} shared={shared} response={response} explaining={shared.phase === "EXPLAIN"} /> : null;
      break;
    case "OWN":
      body = mine.own ? (
        <OwnScreen
          key={mine.own.slots.length}
          t={t}
          shared={shared}
          own={mine.own}
          extraTime={extraTime}
          skew={skew}
          sessionId={sessionId}
          run={run}
          setError={setError}
          onMine={setMine}
        />
      ) : (
        <p className="text-lg">{t.waitingRoom}</p>
      );
      break;
    case "RECAP":
      body = <LiveRecap t={t} shared={shared} sessionId={sessionId} pace={mine.pace} missed={mine.missedBeforeJoining} />;
      break;
  }

  const ownPassage = shared.phase === "OWN" && !!mine.own?.slots.some((s) => s.content.passageText);
  return (
    <Frame top={top} banners={banners} wide={(!!item?.content.passageText && shared.phase !== "EXAMPLE") || ownPassage}>
      {body}
    </Frame>
  );
}

// ---------------------------------------------------------------------------

function Shell({ t, toggle, title, children }: { t: Strings; toggle: () => void; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <LogoMark className="size-6 text-primary" />
        <span className="font-semibold">{title}</span>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={toggle}>
          {t.language}
        </Button>
      </div>
      <div className="mx-auto w-full max-w-4xl p-4 sm:p-8">{children}</div>
    </div>
  );
}

function TopBar({
  t,
  toggle,
  shared,
  clock,
  extraTime,
}: {
  t: Strings;
  toggle: () => void;
  shared: SharedState;
  clock: number | null;
  extraTime: boolean;
}) {
  const item = shared.item;
  const position =
    item?.number && (shared.phase === "THINK" || shared.phase === "TALK" || shared.phase === "REVOTE" || shared.phase === "REVEAL" || shared.phase === "EXPLAIN")
      ? t.question(item.number, shared.classQuestionCount)
      : item?.kind === "TWIN"
        ? t.oneLikeIt
        : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3" data-wt-cover>
      <LogoMark className="size-6 shrink-0 text-primary" />
      <span className="font-semibold">{t.guided}</span>
      <span className="min-w-0 truncate text-muted-foreground">
        {shared.teacherName} · {shared.className}
      </span>
      <span className="flex-1" />
      {position && <span className="rounded-full border border-border px-3 py-0.5 text-sm">{position}</span>}
      {extraTime ? (
        <span className="rounded-full border border-primary px-3 py-0.5 text-sm text-primary">{t.extraTime}</span>
      ) : (
        clock !== null && (
          <span className="rounded-full border border-border px-3 py-0.5 font-mono text-sm tabular-nums" aria-label={`${formatClock(clock)} ${t.left}`}>
            {formatClock(clock)} {t.left}
          </span>
        )
      )}
      <Button variant="outline" size="sm" onClick={toggle}>
        {t.language}
      </Button>
    </div>
  );
}

function Frame({ top, banners, children, wide = false }: { top: React.ReactNode; banners: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex flex-1 flex-col">
      {top}
      <div className={`mx-auto flex w-full flex-col gap-4 p-4 sm:p-8 ${wide ? "max-w-screen-2xl" : "max-w-4xl"}`} aria-live="polite">
        {banners}
        {children}
      </div>
    </div>
  );
}

function EyesUp({ t, body }: { t: Strings; body: string }) {
  return (
    <div className="rounded-2xl bg-surface-deep p-6 text-surface-deep-foreground">
      <p className="text-display-sm font-semibold">{t.eyesUp}</p>
      <p className="mt-2 text-lg opacity-90">{body}</p>
    </div>
  );
}

function JoinScreen({
  t,
  practice,
  sessionId,
  onJoined,
  setError,
}: {
  t: Strings;
  practice: boolean;
  sessionId: string;
  onJoined: (mine: PersonalState) => void;
  setError: (e: string | null) => void;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="rounded-3xl bg-surface-tint p-6 sm:p-10">
      <h1 className="text-page-title">{t.joinTitle}</h1>
      <p className="mt-3 max-w-xl text-lg text-foreground/80">{practice ? t.joinBodyPractice : t.joinBody}</p>
      <Button
        size="cta"
        className="mt-6"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await joinSessionAction(sessionId);
            if (r.ok) {
              setError(null);
              onJoined(r.mine);
            } else setError(r.error);
          })
        }
      >
        {pending ? t.joining : t.join}
      </Button>
    </div>
  );
}

function PlanScreen({ t, shared }: { t: Strings; shared: SharedState }) {
  const parts = [t.planLearn, t.planTogether(shared.classQuestionCount), t.planOwn(shared.ownQuestionCount), t.planRecap];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="font-mono text-xs tracking-wider text-primary uppercase">{t.plan}</p>
        <h1 className="mt-2 text-page-title">{shared.categoryLabel}</h1>
      </div>
      <ol className="divide-y divide-border rounded-2xl border border-border">
        {parts.map((p, i) => (
          <li key={p} className="flex items-center gap-4 p-4 text-lg">
            <span className="font-mono text-sm text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
            {p}
          </li>
        ))}
      </ol>
      <p className="text-base text-muted-foreground">{t.planWhy}</p>
    </div>
  );
}

type ResponseView = NonNullable<PersonalState["response"]>;
type Runner = <T>(call: () => Promise<T>, tries?: number) => Promise<T | null>;

/**
 * One vote on the question the room is on. Choosing saves a draft (so if the
 * room moves on, the choice still counts); Submit sends it.
 */
function VoteStage({
  t,
  shared,
  sessionId,
  vote,
  response,
  label,
  hint,
  showConfidence,
  run,
  setError,
  onSent,
}: {
  t: Strings;
  shared: SharedState;
  sessionId: string;
  vote: 1 | 2;
  response: ResponseView | null;
  label: string;
  hint: string;
  showConfidence: boolean;
  run: Runner;
  setError: (e: string | null) => void;
  onSent: (r: ResponseView) => void;
}) {
  const item = shared.item!;
  const sent = vote === 1 ? response?.firstAnswer ?? null : response?.secondAnswer ?? null;
  const [value, setValue] = useState<string>(sent ?? response?.draft ?? (vote === 2 ? response?.firstAnswer ?? "" : ""));
  const [sending, setSending] = useState(false);
  const [confidence, setConfidence] = useState(response?.confidence ?? null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function change(next: string) {
    setValue(next);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      void saveDraftAction(sessionId, item.id, next || null).catch(() => {});
    }, 500);
  }

  async function submit() {
    if (!value.trim() || sending || sent) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    setSending(true);
    const r = await run(() => submitAnswerAction(sessionId, item.id, value));
    setSending(false);
    if (!r) return;
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    const base: ResponseView = response ?? { itemId: item.id, draft: null, firstAnswer: null, secondAnswer: null, confidence: null };
    onSent(r.vote === 1 ? { ...base, firstAnswer: value, draft: null } : { ...base, secondAnswer: value, draft: null });
  }

  const answered = vote === 1 ? item.firstAnswered : item.secondAnswered;
  return (
    <div className="flex flex-col gap-5">
      <p className="font-mono text-xs tracking-wider text-primary uppercase">{label}</p>
      <GuidedQuestion
        content={item.content}
        value={value}
        onChange={sent ? undefined : change}
        onSubmit={submit}
        disabled={!!sent || sending}
        firstAnswer={vote === 2 ? response?.firstAnswer ?? null : null}
        t={t}
      />
      {sent ? (
        <div className="flex flex-col gap-4 rounded-2xl bg-surface-tint p-5">
          <p className="text-lg font-semibold">
            {t.submitted}: {choiceLetter(item.content, sent)}
          </p>
          {showConfidence && (
            <div className="flex flex-col gap-2">
              <p className="text-base">{t.howSure}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t.howSure}>
                {(
                  [
                    ["SURE", t.sure],
                    ["THINK_SO", t.thinkSo],
                    ["GUESSING", t.guessing],
                  ] as const
                ).map(([key, text]) => (
                  <Button
                    key={key}
                    variant={confidence === key ? "default" : "outline"}
                    size="xl"
                    aria-pressed={confidence === key}
                    onClick={() => {
                      setConfidence(key);
                      void confidenceAction(sessionId, item.id, key).catch(() => {});
                    }}
                  >
                    {text}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <p className="text-base text-muted-foreground">
            {t.waitingRoom} · {t.inCount(answered, shared.joined)}
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <Button size="cta" onClick={submit} disabled={!value.trim() || sending}>
            {t.submit}
          </Button>
          <p className="text-base text-muted-foreground">{hint}</p>
        </div>
      )}
    </div>
  );
}

function TalkScreen({ t, shared, firstAnswer }: { t: Strings; shared: SharedState; firstAnswer: string | null }) {
  const item = shared.item!;
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-page-title">{t.talk}</h1>
      <p className="max-w-2xl text-lg">{t.talkBody}</p>
      <div className="rounded-2xl bg-surface-tint p-5">
        {firstAnswer ? (
          <>
            <p className="text-lg font-semibold">
              {t.youPicked(choiceLetter(item.content, firstAnswer))}
              {item.content.questionType === "MULTIPLE_CHOICE" && (
                <>
                  {" · "}
                  <LatexText text={item.content.answerChoices.find((c) => c.id === firstAnswer)?.text ?? ""} />
                </>
              )}
            </p>
            <p className="mt-1 text-base text-muted-foreground">{t.talkNotYet}</p>
          </>
        ) : (
          <p className="text-lg">{t.noFirstAnswer}</p>
        )}
      </div>
      <div>
        <p className="font-mono text-xs tracking-wider text-muted-foreground uppercase">{t.tryStarting}</p>
        <div className="mt-2 flex flex-col gap-2">
          <span className="rounded-lg border border-dashed border-foreground/30 p-3 text-lg">{t.starter1}</span>
          <span className="rounded-lg border border-dashed border-foreground/30 p-3 text-lg">{t.starter2}</span>
        </div>
      </div>
      <details className="rounded-xl border border-border p-4">
        <summary className="cursor-pointer text-base">{item.label}</summary>
        <div className="mt-4">
          <GuidedQuestion content={item.content} value={firstAnswer ?? ""} disabled t={t} />
        </div>
      </details>
    </div>
  );
}

function RevealScreen({
  t,
  shared,
  response,
  explaining,
}: {
  t: Strings;
  shared: SharedState;
  response: ResponseView | null;
  explaining: boolean;
}) {
  const item = shared.item!;
  const reveal = item.reveal!;
  const first = response?.firstAnswer ?? null;
  const second = response?.secondAnswer ?? null;
  const final = second ?? first;
  const right = isRight(item.content, final, reveal);
  const letter = (a: string | null) => choiceLetter(item.content, a);
  const isChoice = item.content.questionType === "MULTIPLE_CHOICE";

  let line: string;
  if (!final) line = `${t.notAnswered} ${t.answerIs(reveal.correctLabel)}`;
  else if (second && first && second !== first) {
    line = `${t.changed(letter(first), letter(second))} ${right ? `${t.correct} ${t.talkWorked}` : t.answerIs(reveal.correctLabel)}`;
  } else if (second && first) {
    line = right ? `${t.youChose(letter(final))} ${t.correct} ${t.hadIt}` : `${t.bothTimes(letter(final))} ${t.answerIs(reveal.correctLabel)}`;
  } else {
    const chose = isChoice ? t.youChose(letter(final)) : t.youEntered(final);
    line = right ? `${chose} ${t.correct}` : `${chose} ${t.answerIs(reveal.correctLabel)}`;
  }
  const distractor = !right && final ? reveal.distractors[final] ?? null : null;
  const hard = reveal.firstRight !== null && reveal.firstRight < TALK_FROM && item.kind === "CLASS";

  return (
    <div className="flex flex-col gap-5">
      <p role="status" className={`text-xl font-semibold ${right ? "text-green-800 dark:text-green-300" : final ? "text-destructive" : ""}`}>
        {line}
      </p>
      {distractor && (
        <div className="rounded-2xl bg-surface-tint p-4">
          <p className="font-semibold">{t.whyTempting(letter(final))}</p>
          <LatexText text={distractor} className="mt-1 block text-base" />
        </div>
      )}
      {hard && !explaining && <p className="rounded-2xl bg-surface-tint p-4 text-lg">{t.hardOne}</p>}
      {explaining && item.steps ? (
        <div className="flex flex-col gap-3">
          <p className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
            {t.followBoard} · {t.step(item.steps.length, item.stepTotal)}
          </p>
          <StepsList steps={item.steps} upTo={item.steps.length - 1} />
        </div>
      ) : null}
      {item.takeaway && (
        <p className="rounded-2xl border border-border p-4 text-base">
          <span className="font-semibold">{t.remember}: </span>
          <LatexText text={item.takeaway} />
        </p>
      )}
      <GuidedQuestion content={item.content} value={final ?? ""} disabled reveal={reveal} t={t} />
    </div>
  );
}

type OwnView = NonNullable<PersonalState["own"]>;

function OwnScreen({
  t,
  shared,
  own,
  extraTime,
  skew,
  sessionId,
  run,
  setError,
  onMine,
}: {
  t: Strings;
  shared: SharedState;
  own: OwnView;
  extraTime: boolean;
  skew: number;
  sessionId: string;
  run: Runner;
  setError: (e: string | null) => void;
  onMine: (m: PersonalState) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, Feedback>>(() =>
    Object.fromEntries(own.slots.filter((s) => s.feedback).map((s) => [s.id, s.feedback!])),
  );
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [showing, setShowing] = useState<string | null>(null);
  const [bonusMissing, setBonusMissing] = useState(false);
  // Individual practice runs at the student's own pace: no clock, no bonus.
  const individual = shared.mode === "INDIVIDUAL";
  const endsAt = shared.phaseStartedAt + own.seconds * 1000;
  const clock = useCountdown(individual ? null : endsAt, skew);

  const main = own.slots.filter((s) => !s.bonus);
  const bonus = own.slots.find((s) => s.bonus) ?? null;
  const next = main.find((s) => !answers[s.id]) ?? (bonus && !answers[bonus.id] ? bonus : null);
  const current = showing ? own.slots.find((s) => s.id === showing) ?? null : next;
  const right = main.filter((s) => answers[s.id]?.isCorrect).length;

  async function submit() {
    if (!current || !value.trim() || sending) return;
    setSending(true);
    const r = await run(() => ownAnswerAction(current.id, value));
    setSending(false);
    if (!r) return;
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    setAnswers((a) => ({ ...a, [current.id]: r.feedback }));
    setShowing(current.id);
  }

  const header = (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <p className="font-mono text-xs tracking-wider text-primary uppercase">{t.own}</p>
        <p className="text-base text-muted-foreground">{t.ownSub}</p>
      </div>
      {clock !== null && (
        <span className={`rounded-full border px-3 py-0.5 font-mono text-sm tabular-nums ${extraTime ? "border-primary text-primary" : "border-border"}`}>
          {formatClock(clock)} {t.left}
          {extraTime ? ` · ${t.extraTime}` : ""}
        </span>
      )}
    </div>
  );

  if (!current) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <h1 className="text-page-title">{t.done}</h1>
        <p className="text-display-sm font-semibold">{t.rightOf(right, main.length)}</p>
        {extraTime && <p className="text-base text-muted-foreground">{t.notYourClock}</p>}
        {!individual && !bonus && !bonusMissing && (
          <div className="rounded-2xl bg-surface-tint p-5">
            <p className="text-lg font-semibold">{t.bonus}</p>
            <p className="mt-1 text-base text-muted-foreground">{t.bonusSub}</p>
            <Button
              size="xl"
              className="mt-4"
              onClick={async () => {
                const r = await run(() => bonusAction(sessionId));
                if (r?.ok) {
                  if (!r.created) setBonusMissing(true);
                  onMine(r.mine);
                }
              }}
            >
              {t.bonus}
            </Button>
          </div>
        )}
        {bonusMissing && <p className="text-base text-muted-foreground">{t.bonusNone}</p>}
      </div>
    );
  }

  const index = current.bonus ? null : main.indexOf(current) + 1;
  const feedback = answers[current.id] ?? null;
  return (
    <div className="flex flex-col gap-5">
      {header}
      <p className="text-base font-medium">{current.bonus ? t.bonus : t.ownOf(index!, main.length)}</p>
      <GuidedQuestion
        key={current.id}
        content={current.content}
        value={feedback ? feedback.answer : value}
        onChange={feedback ? undefined : setValue}
        onSubmit={submit}
        disabled={!!feedback || sending}
        reveal={feedback ? { correctChoiceId: feedback.correctChoiceId, acceptedAnswers: feedback.acceptedAnswers } : null}
        t={t}
      />
      {feedback ? (
        <div className="flex flex-col gap-4">
          <p role="status" className={`text-xl font-semibold ${feedback.isCorrect ? "text-green-800 dark:text-green-300" : "text-destructive"}`}>
            {feedback.isCorrect ? t.correct : t.answerIs(choiceLetter(current.content, feedback.correctChoiceId) || feedback.acceptedAnswers[0] || "")}
          </p>
          {feedback.distractor && <LatexText text={feedback.distractor} className="block rounded-2xl bg-surface-tint p-4 text-base" />}
          {feedback.steps.length > 0 && (
            <details className="rounded-xl border border-border p-4" open={!feedback.isCorrect}>
              <summary className="cursor-pointer text-base font-medium">{t.allSteps}</summary>
              <StepsList steps={feedback.steps} upTo={feedback.steps.length - 1} className="mt-3" />
            </details>
          )}
          <div>
            <Button
              size="cta"
              onClick={() => {
                setShowing(null);
                setValue("");
              }}
            >
              {t.next}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <Button size="cta" onClick={submit} disabled={!value.trim() || sending}>
            {t.submit}
          </Button>
          <p className="text-base text-muted-foreground">{t.draftHint}</p>
        </div>
      )}
    </div>
  );
}

function LiveRecap({
  t,
  shared,
  sessionId,
  pace,
  missed,
}: {
  t: Strings;
  shared: SharedState;
  sessionId: string;
  pace: PersonalState["pace"];
  missed: number;
}) {
  const [recap, setRecap] = useState<StudentRecap | null>(null);
  const [chosen, setChosen] = useState(pace);
  useEffect(() => {
    let cancelled = false;
    void recapAction(sessionId).then((r) => {
      if (!cancelled && r.ok) setRecap(r.recap);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const own = recap?.own.filter((o) => !o.bonus) ?? [];
  const ownRight = own.filter((o) => o.feedback?.isCorrect).length;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="font-mono text-xs tracking-wider text-primary uppercase">{t.recap}</p>
        <h1 className="mt-2 text-page-title">{shared.categoryLabel}</h1>
      </div>
      {recap && (
        <div className="grid gap-6 md:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="mb-2 text-base font-semibold">{t.together}</p>
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {recap.questions
                .filter((q) => q.kind !== "WARMUP")
                .map((q) => {
                  const final = q.secondAnswer !== null ? q.secondCorrect : q.firstCorrect;
                  return (
                    <li key={q.itemId} className="flex flex-wrap items-baseline gap-x-3 p-3 text-base">
                      <span className="w-40 font-medium">{q.label}</span>
                      {q.firstAnswer === null && q.secondAnswer === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : final ? (
                        <span className="font-semibold text-green-800 dark:text-green-300">
                          {t.right}
                          {q.secondAnswer !== null && q.firstAnswer !== null && !q.firstCorrect ? ` ${t.onSecondVote}` : ""}
                        </span>
                      ) : (
                        <span className="font-semibold text-destructive">{t.missed}</span>
                      )}
                    </li>
                  );
                })}
            </ul>
            {missed > 0 && <p className="mt-2 text-base text-muted-foreground">{t.joinedLate(missed)}</p>}
          </div>
          <div>
            <p className="mb-2 text-base font-semibold">{t.own}</p>
            <p className="text-hero font-semibold tabular-nums">
              {ownRight}/{own.length}
            </p>
          </div>
        </div>
      )}
      {shared.recap && shared.recap.takeaways.length > 0 && (
        <div className="rounded-2xl bg-surface-tint p-5">
          <p className="font-semibold">{t.remember}</p>
          <ul className="mt-2 flex flex-col gap-2">
            {shared.recap.takeaways.map((k) => (
              <li key={k} className="text-base">
                <LatexText text={k} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-base">{t.pace}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t.pace}>
          {(
            [
              ["TOO_FAST", t.tooFast],
              ["ABOUT_RIGHT", t.aboutRight],
              ["TOO_SLOW", t.tooSlow],
            ] as const
          ).map(([key, text]) => (
            <Button
              key={key}
              size="xl"
              variant={chosen === key ? "default" : "outline"}
              aria-pressed={chosen === key}
              onClick={() => {
                setChosen(key);
                void paceAction(sessionId, key).catch(() => {});
              }}
            >
              {text}
            </Button>
          ))}
        </div>
        {chosen && <p className="text-sm text-muted-foreground">{t.thanks}</p>}
      </div>
    </div>
  );
}
