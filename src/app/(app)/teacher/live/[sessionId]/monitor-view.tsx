"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { LogoMark } from "@/components/logo";
import { StatStrip, StatusChip } from "@/components/staff/staff-ui";
import { CONSOLE_POLL_MS } from "@/lib/guided/config";
import type { MonitorView as MonitorData } from "@/lib/guided/console";
import type { GuidedCommand } from "@/lib/guided/control";
import { MODE_LABELS } from "@/lib/guided/modes";
import type { MonitorRow, MonitorState } from "@/lib/guided/monitor";
import { monitorGuidance } from "@/lib/guided/script";
import { commandAction } from "../actions";

const STATE_WORDS: Record<MonitorState, string> = {
  NOT_HERE: "Not here yet",
  AWAY: "Away",
  NEEDS_HELP: "Needs help",
  IDLE: "Idle",
  WORKING: "Working",
  DONE: "Done",
};

const STATE_TONE: Record<MonitorState, "good" | "warn" | "muted" | "bad"> = {
  NOT_HERE: "muted",
  AWAY: "muted",
  NEEDS_HELP: "bad",
  IDLE: "warn",
  WORKING: "good",
  DONE: "good",
};

/** Who to look at first. */
const ATTENTION_ORDER: MonitorState[] = ["NEEDS_HELP", "IDLE", "AWAY", "WORKING", "DONE", "NOT_HERE"];

function quietFor(ms: number | null): string {
  if (ms === null) return "—";
  const minutes = Math.floor(ms / 60_000);
  return minutes < 1 ? "Just now" : `${minutes} min ago`;
}

/**
 * The teacher's screen for individual practice. Nothing to pace: each student
 * works through their own questions at their own speed, and this screen says
 * who has joined, how far each student has got, and who needs a word. It
 * names students, so it stays on the teacher's laptop. It polls every two
 * seconds, like the teacher-led console.
 */
export function MonitorView({ initial }: { initial: MonitorData }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
          const next = (await res.json()) as MonitorData;
          if (!stopped) {
            setState(next);
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
      setError(r.ok ? null : r.error);
    } catch {
      setError("That didn't reach PrepHub. Check the connection and press it again.");
    } finally {
      setBusy(false);
      pollNow.current();
    }
  }

  const { totals } = state;
  const guidance = monitorGuidance({
    joined: totals.joined,
    rosterSize: state.rosterSize,
    idle: totals.idle,
    needsHelp: totals.needsHelp,
    done: totals.done,
  });
  const rows = useMemo(
    () =>
      [...state.rows].sort(
        (a, b) => ATTENTION_ORDER.indexOf(a.state) - ATTENTION_ORDER.indexOf(b.state) || a.name.localeCompare(b.name),
      ),
    [state.rows],
  );
  const accuracy = totals.accuracy === null ? "—" : `${Math.round(totals.accuracy * 100)}%`;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-6">
        <LogoMark className="size-6 text-primary" />
        <span className="font-semibold">
          {state.className} · {MODE_LABELS.INDIVIDUAL}
        </span>
        <span className="text-muted-foreground">{state.skillLabel}</span>
        <span className="flex-1" />
        <Button size="xl" variant="outline" onClick={() => send({ type: "PAUSE", paused: !state.paused })} aria-pressed={state.paused}>
          {state.paused ? "Resume screens" : "Pause screens"}
        </Button>
        <ConfirmButton
          size="xl"
          title="End the session?"
          description="Every student's screen moves to their results now, and you'll see how each student did. Questions a student hasn't reached stay unanswered. A session can't be reopened."
          confirmLabel="End the session"
          onConfirm={() => send({ type: "END" })}
        >
          End session
        </ConfirmButton>
      </div>

      {(error || offline) && (
        <div className="px-4 pt-4 sm:px-6">
          <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-base text-destructive">
            {offline ? "Reconnecting to PrepHub. Students' screens keep going." : error}
          </p>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4 rounded-2xl bg-surface-tint p-5">
            <p className="font-mono text-xs tracking-wider text-muted-foreground uppercase">What to do now</p>
            <p className="text-xl font-semibold">{guidance.title}</p>
            <ol className="list-decimal space-y-1.5 pl-6 text-base text-foreground/90">
              {guidance.doThis.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
            <div>
              <p className="text-base font-semibold">What to say</p>
              {guidance.say.map((line) => (
                <p key={line} className="mt-1 border-l-4 border-primary/50 pl-3 text-base">
                  &ldquo;{line}&rdquo;
                </p>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2 rounded-2xl border border-border p-5">
            <p className="text-base text-muted-foreground">Students join at prephubtp.com/live with</p>
            <p className="font-mono text-3xl font-semibold tracking-widest">{state.joinCode}</p>
            <p className="text-base">
              <span className="font-semibold tabular-nums">{totals.joined}</span> of {state.rosterSize} here
            </p>
            <p className="text-sm text-muted-foreground">
              Each student gets {state.questionsPerStudent} questions of their own and works at their own speed. The right answer and
              an explanation show as soon as they answer. These answers don&apos;t change anyone&apos;s predicted score.
            </p>
          </div>
        </div>

        <StatStrip
          stats={[
            { label: "Here", value: `${totals.joined} of ${state.rosterSize}`, hint: "students in the class" },
            { label: "Finished", value: `${totals.done} of ${totals.joined}`, hint: `answered all ${state.questionsPerStudent} questions` },
            { label: "Right so far", value: accuracy, hint: `${totals.correct} of ${totals.answered} answers` },
            {
              label: "Need a word",
              value: String(totals.needsHelp + totals.idle),
              hint: `${totals.needsHelp} need help, ${totals.idle} idle`,
            },
          ]}
        />

        <section aria-labelledby="monitor-students" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="monitor-students" className="text-lg">
              The students
            </h2>
            <p className="text-sm text-muted-foreground">Only on your screen. Anyone who needs a look is listed first.</p>
          </div>
          {rows.length === 0 ? (
            <p className="rounded-2xl bg-surface-tint p-5 text-base text-muted-foreground">There are no students in this class yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[40rem] text-left text-base">
                <caption className="sr-only">Each student&apos;s progress in this practice session</caption>
                <thead className="border-b border-border text-sm text-muted-foreground">
                  <tr>
                    <th scope="col" className="p-3 font-medium">Student</th>
                    <th scope="col" className="p-3 font-medium">Status</th>
                    <th scope="col" className="p-3 font-medium">Answered</th>
                    <th scope="col" className="p-3 font-medium">Right</th>
                    <th scope="col" className="p-3 font-medium">Now on</th>
                    <th scope="col" className="p-3 font-medium">Last answer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <StudentRowView key={r.studentId} row={r} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function StudentRowView({ row }: { row: MonitorRow }) {
  const here = row.state !== "NOT_HERE";
  return (
    <tr className={row.state === "NEEDS_HELP" ? "bg-destructive/5" : undefined}>
      <th scope="row" className="p-3 font-semibold">
        {row.name}
      </th>
      <td className="p-3">
        <StatusChip tone={STATE_TONE[row.state]}>{STATE_WORDS[row.state]}</StatusChip>
      </td>
      <td className="p-3 tabular-nums">
        {here ? (
          <span className="flex items-center gap-2">
            <progress
              className="h-2 w-20 overflow-hidden rounded [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-foreground/10 [&::-webkit-progress-value]:bg-primary"
              value={row.answered}
              max={Math.max(row.total, 1)}
              aria-label={`${row.name}: ${row.answered} of ${row.total} answered`}
            />
            {row.answered} of {row.total}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="p-3 tabular-nums">{here && row.answered > 0 ? `${row.correct} of ${row.answered}` : "—"}</td>
      <td className="p-3 text-muted-foreground">
        {row.current ? `Question ${row.current}${row.currentSkill ? ` · ${row.currentSkill}` : ""}` : here && row.total > 0 ? "Finished" : "—"}
      </td>
      <td className="p-3 text-muted-foreground">{here ? quietFor(row.quietMs) : "—"}</td>
    </tr>
  );
}
