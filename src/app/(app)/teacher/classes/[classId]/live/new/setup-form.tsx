"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { StaffSection, StatusChip } from "@/components/staff/staff-ui";
import type { SessionSetup } from "@/lib/guided/create";
import { INDIVIDUAL_PRACTICE, SESSION_LENGTHS, type SessionLength } from "@/lib/guided/config";
import { EACH_STUDENTS_WEAKEST, MODE_LABELS } from "@/lib/guided/modes";
import type { GuidedSessionMode } from "@/generated/prisma/client";
import type { QuestionCategory } from "@/generated/prisma/client";
import { startSessionAction } from "../../../../live/actions";

type Filter = "ALL" | "MATH" | "READING_WRITING";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "Either section" },
  { key: "MATH", label: "Math" },
  { key: "READING_WRITING", label: "Reading & Writing" },
];
const LENGTHS: { key: SessionLength; label: string; detail: string }[] = [
  { key: "SHORT", label: "25 minutes", detail: "2 questions together, 3 on their own" },
  { key: "STANDARD", label: "30 minutes", detail: "3 questions together, 4 on their own" },
  { key: "LONG", label: "45 minutes", detail: "4 questions together, 6 on their own" },
];

/**
 * Choosing what the class works on. PrepHub suggests the skill where the most
 * students are below the college-ready line, weighted by how much of the SAT
 * it is, and says why in counts. The teacher always has the last word.
 *
 * Submits through onSubmit + startTransition, not `<form action>`: React 19
 * resets a form after its action, which would put the radio buttons back on
 * their defaults if the server refused (CLAUDE.md, College Apps gotcha).
 */
export function SetupForm({
  classroomId,
  rosterSize,
  picks,
  minStudents,
}: {
  classroomId: string;
  rosterSize: number;
  picks: SessionSetup["picks"];
  minStudents: number;
}) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const pick = picks[filter];
  const [mode, setMode] = useState<GuidedSessionMode>("TEACHER_LED");
  const [chosen, setChosen] = useState<QuestionCategory | "WEAKEST" | null>(picks.ALL.pick);
  const [length, setLength] = useState<SessionLength>("STANDARD");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const individual = mode === "INDIVIDUAL";
  const selected =
    chosen === "WEAKEST" && individual
      ? "WEAKEST"
      : chosen && chosen !== "WEAKEST" && pick.ranked.some((r) => r.category === chosen)
        ? chosen
        : (pick.pick ?? null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) {
      setError("Choose a skill.");
      return;
    }
    const fd = new FormData();
    fd.set("category", selected);
    fd.set("length", length);
    fd.set("mode", mode);
    start(async () => {
      const result = await startSessionAction(classroomId, {}, fd);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-10">
      <StaffSection
        title="1. How should it run?"
        description="Both keep each student's results for you. Session answers are practice: a student's predicted score moves with their own Practice Sets."
      >
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">Mode</legend>
          {(
            [
              {
                key: "TEACHER_LED",
                detail:
                  `You run it from the front. The whole class does the same warm-up, example and questions together, then each student gets questions of their own. ${LENGTHS.find((l) => l.key === length)?.label ?? "About 30 minutes"}, as chosen below. The screen tells you what to do and say.`,
              },
              {
                key: "INDIVIDUAL",
                detail: `Every student works alone, at their own speed, on questions picked for them (${INDIVIDUAL_PRACTICE.questions} each, usually 15 to 20 minutes). You walk around and watch who is stuck. No teaching needed: each answer is explained on the student's screen.`,
              },
            ] as const
          ).map((m) => (
            <label
              key={m.key}
              className="flex cursor-pointer gap-3 rounded-2xl border border-border p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="radio"
                name="mode"
                value={m.key}
                checked={mode === m.key}
                onChange={() => setMode(m.key)}
                className="mt-1 size-5 accent-[var(--primary)]"
              />
              <span>
                <span className="block text-lg font-medium">{MODE_LABELS[m.key]}</span>
                <span className="text-base text-muted-foreground">{m.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </StaffSection>

      <StaffSection
        title="2. What should the class work on?"
        description={
          pick.ready ? (
            <>
              Ranked by how many of your {pick.measured} students with a Diagnostic are below the college-ready line in
              each skill (480 in Reading &amp; Writing, 530 in Math), weighted by how much of the SAT the skill is. You
              see counts for the class, never which students.
            </>
          ) : (
            <>
              {pick.measured === 0
                ? "No one in this class has taken the Diagnostic yet"
                : `Only ${pick.measured} of your ${rosterSize} students have taken the Diagnostic`}
              , so PrepHub can&apos;t suggest a skill until at least {minStudents} have. Choose one yourself. A first
              session spent on the Diagnostic (about 20 minutes) fixes this.
            </>
          )
        }
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label="Section">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              type="button"
              size="xl"
              variant={filter === f.key ? "default" : "outline"}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <fieldset className="divide-y divide-border rounded-2xl border border-border">
          <legend className="sr-only">Skill</legend>
          {individual && (
            <label className="flex cursor-pointer flex-col gap-2 p-5 transition-colors hover:bg-muted/30 has-[:checked]:bg-primary/5 md:flex-row md:items-center md:gap-6">
              <span className="flex items-center gap-4 md:w-80">
                <input
                  type="radio"
                  name="category"
                  value="WEAKEST"
                  checked={selected === "WEAKEST"}
                  onChange={() => setChosen("WEAKEST")}
                  className="size-5 accent-[var(--primary)]"
                />
                <span>
                  <span className="block text-lg font-medium">{EACH_STUDENTS_WEAKEST}</span>
                  <span className="text-base text-muted-foreground">Personalized for each student</span>
                </span>
              </span>
              <span className="flex-1 text-base text-muted-foreground">
                Each student&apos;s questions come from the {INDIVIDUAL_PRACTICE.skillsPerStudent} skills they are weakest in. A student
                who hasn&apos;t taken the Diagnostic gets a mix.
              </span>
              <span className="flex flex-wrap gap-2">
                <StatusChip tone="good">Personalized</StatusChip>
              </span>
            </label>
          )}
          {pick.ranked.map((r, i) => {
            const isPick = pick.ready && r.category === pick.pick;
            const thin = r.questions < 6;
            return (
              <label
                key={r.category}
                className="flex cursor-pointer flex-col gap-2 p-5 transition-colors hover:bg-muted/30 has-[:checked]:bg-primary/5 md:flex-row md:items-center md:gap-6"
              >
                <span className="flex items-center gap-4 md:w-80">
                  <input
                    type="radio"
                    name="category"
                    value={r.category}
                    checked={selected === r.category}
                    onChange={() => setChosen(r.category)}
                    className="size-5 accent-[var(--primary)]"
                  />
                  <span>
                    <span className="block text-lg font-medium">{r.label}</span>
                    <span className="text-base text-muted-foreground">
                      {r.section === "MATH" ? "Math" : "Reading & Writing"} · {Math.round(r.weight * 100)}% of its section
                    </span>
                  </span>
                </span>
                <span className="flex-1 text-base tabular-nums">
                  {pick.ready ? (
                    <>
                      <span className="font-semibold">{r.below}</span> of {r.measured} below the line
                    </>
                  ) : (
                    <span className="text-muted-foreground">{r.questions} questions in the bank</span>
                  )}
                </span>
                <span className="flex flex-wrap gap-2">
                  {isPick && <StatusChip tone="good">Suggested</StatusChip>}
                  {pick.ready && !isPick && i <= 2 && <StatusChip tone="muted">Alternative</StatusChip>}
                  {r.recent && <StatusChip tone="muted">Last session · counts half</StatusChip>}
                  {thin && <StatusChip tone="warn">Few questions ({r.questions})</StatusChip>}
                </span>
              </label>
            );
          })}
        </fieldset>
      </StaffSection>

      {!individual && (
      <StaffSection title="3. How long?" description="The parts stay the same; only the number of questions changes.">
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="sr-only">Length</legend>
          {LENGTHS.map((l) => (
            <label
              key={l.key}
              className="flex cursor-pointer gap-3 rounded-2xl border border-border p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="radio"
                name="length"
                value={l.key}
                checked={length === l.key}
                onChange={() => setLength(l.key)}
                className="mt-1 size-5 accent-[var(--primary)]"
              />
              <span>
                <span className="block text-lg font-medium">{l.label}</span>
                <span className="text-base text-muted-foreground">{l.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="text-base text-muted-foreground">
          Own-question clock: {Math.round(SESSION_LENGTHS[length].ownSeconds / 60)} minutes, longer for students you&apos;ve
          given extra time.
        </p>
      </StaffSection>
      )}

      <div className="flex flex-col gap-3 rounded-3xl bg-surface-tint p-6">
        <p className="text-lg">
          {individual
            ? "Opening the session starts it at once. Students in this class see a Join button on their PrepHub home page; anyone else types the code at prephubtp.com/live. Each student's questions are picked when they join."
            : "Opening the session puts a join screen on the board. Students in this class see a Join button on their PrepHub home page; anyone else types the code at prephubtp.com/live. Nothing starts until you press Start."}
        </p>
        {error && (
          <p role="alert" className="text-base text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="cta" className="w-fit" disabled={pending || !selected}>
          {pending ? "Opening…" : "Open the session"}
        </Button>
      </div>
    </form>
  );
}
