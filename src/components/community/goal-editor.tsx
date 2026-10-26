"use client";

import { startTransition, useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StaffField } from "@/components/staff/staff-ui";

export type GoalEditorState = { error?: string; success?: boolean };

const METRIC_OPTIONS = [
  { value: "NONE", label: "No goal right now" },
  { value: "QUESTIONS_ANSWERED", label: "Questions answered" },
  { value: "STUDY_HOURS", label: "Hours studied" },
  { value: "ADAPTIVE_SESSIONS", label: "Practice Sets finished" },
] as const;

/** Mirrors GOAL_TARGET_MAX in lib/community/goal.ts, which is what's enforced; this only helps the browser say so first. */
const TARGET_MAX = 10_000_000;

const TARGET_HINTS: Record<string, string> = {
  QUESTIONS_ANSWERED: "Every question any student answers counts: practice, homework, the Daily Challenge, all of it.",
  STUDY_HOURS: "Time spent in finished practice sessions, added up across the school.",
  ADAPTIVE_SESSIONS: "Each personalized Practice Set a student finishes counts as one.",
};

/**
 * The one form for a school's community goal — used by the Owner on the
 * school's page and by the school's own Administrator — so both are held to
 * the same fields and the same rules (lib/community/goal.ts).
 *
 * Fully controlled and submitted through onSubmit + startTransition, not a
 * `<form action>`: React 19 resets a form after an action completes, which
 * puts a select back on its first option while state still holds the saved
 * one (CLAUDE.md, College Apps gotcha).
 *
 * Set out as four numbered questions (2026-10-25), because "what are we
 * counting, how many, what's the prize, by when" is the whole decision, and
 * an administrator should be able to read it top to bottom once.
 */
export function GoalEditor({
  action,
  hidden = {},
  initial,
}: {
  action: (prev: GoalEditorState, formData: FormData) => Promise<GoalEditorState>;
  hidden?: Record<string, string>;
  initial: { metric: string | null; target: number | null; prize: string | null; endsOn: string };
}) {
  const [state, submit, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [metric, setMetric] = useState<string>(initial.metric ?? "NONE");
  const [target, setTarget] = useState(initial.target ? String(initial.target) : "");
  const [prize, setPrize] = useState(initial.prize ?? "");
  const [endsOn, setEndsOn] = useState(initial.endsOn);
  const active = metric !== "NONE";
  const changesRace = active && (metric !== (initial.metric ?? "NONE") || target !== (initial.target ? String(initial.target) : ""));
  // Clearing a goal wipes its progress, its prize and any win with it, and
  // nothing brings them back — so that one save asks first.
  const clearsGoal = !active && Boolean(initial.metric);

  function send(fd: FormData) {
    if (fd.get("communityGoalMetric") === "NONE") fd.set("communityGoalMetric", "");
    startTransition(() => submit(fd));
  }

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        if (clearsGoal) return; // goes through the confirmation below instead
        send(new FormData(e.currentTarget));
      }}
      className="flex flex-col gap-6"
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription className="text-base">{state.error}</AlertDescription>
        </Alert>
      )}
      {state.success && !pending && (
        <Alert>
          <AlertDescription className="text-base">Saved. Students see it on School Community now.</AlertDescription>
        </Alert>
      )}

      <StaffField label="1. What should the school count?" htmlFor="communityGoalMetric">
        <Select name="communityGoalMetric" value={metric} onValueChange={(v) => setMetric(v ?? "NONE")}>
          <SelectTrigger id="communityGoalMetric" className="h-11 w-full text-base md:text-base sm:max-w-sm">
            <SelectValue>{(v: string) => METRIC_OPTIONS.find((o) => o.value === v)?.label ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {METRIC_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </StaffField>

      <StaffField
        label="2. How many, to reach the goal?"
        htmlFor="communityGoalTarget"
        hint={active ? TARGET_HINTS[metric] : "Choose what to count first."}
      >
        <Input
          id="communityGoalTarget"
          name="communityGoalTarget"
          type="number"
          min={1}
          max={TARGET_MAX}
          step={1}
          inputMode="numeric"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="e.g. 5000"
          disabled={!active}
          className="h-11 text-base md:text-base sm:max-w-xs"
        />
      </StaffField>

      <StaffField
        label="3. What's the prize?"
        htmlFor="communityGoalPrize"
        optional
        hint="Shown to every student beside the progress bar. Only promise what the school will actually give."
      >
        <Input
          id="communityGoalPrize"
          name="communityGoalPrize"
          maxLength={120}
          value={prize}
          onChange={(e) => setPrize(e.target.value)}
          placeholder="e.g. Pizza party for the whole school"
          disabled={!active}
          className="h-11 text-base md:text-base"
        />
      </StaffField>

      <StaffField
        label="4. By when?"
        htmlFor="communityGoalEndsAt"
        optional
        hint="Counts through the end of that day, Central time. Leave it empty for a goal with no deadline."
      >
        <Input
          id="communityGoalEndsAt"
          name="communityGoalEndsAt"
          type="date"
          value={endsOn}
          onChange={(e) => setEndsOn(e.target.value)}
          className="h-11 w-fit text-base md:text-base"
          disabled={!active}
        />
      </StaffField>

      {changesRace && initial.metric && (
        <p className="border-l-2 border-marker pl-4 text-base text-muted-foreground">
          Changing what&apos;s counted or the number starts a new goal: progress starts again from zero today. Changing
          only the prize or the deadline keeps the progress so far.
        </p>
      )}

      {clearsGoal ? (
        <ConfirmButton
          size="xl"
          variant="default"
          className="w-fit"
          destructive
          title="Remove the school's goal?"
          description={`Students stop seeing it on School Community as soon as you confirm. Its progress${
            initial.prize ? ", its prize" : ""
          } and any win are cleared, and can't be brought back: setting a goal again starts counting from zero.`}
          confirmLabel="Remove the goal"
          onConfirm={async () => {
            if (formRef.current) send(new FormData(formRef.current));
          }}
        >
          {pending ? "Saving…" : "Save (no goal)"}
        </ConfirmButton>
      ) : (
        <Button type="submit" size="xl" disabled={pending} className="w-fit">
          {pending ? "Saving…" : active ? "Save goal" : "Save (no goal)"}
        </Button>
      )}
    </form>
  );
}
