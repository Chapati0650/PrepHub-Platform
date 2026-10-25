"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

export type GoalEditorState = { error?: string; success?: boolean };

const METRIC_OPTIONS = [
  { value: "NONE", label: "No goal right now" },
  { value: "QUESTIONS_ANSWERED", label: "Questions Answered" },
  { value: "STUDY_HOURS", label: "Study Hours" },
  { value: "ADAPTIVE_SESSIONS", label: "Adaptive Sessions" },
] as const;

/**
 * The one form for a school's community goal — used by the Owner on the
 * school's page and by the school's own Administrator — so both are held to
 * the same fields and the same rules (lib/community/goal.ts).
 *
 * Fully controlled and submitted through onSubmit + startTransition, not a
 * `<form action>`: React 19 resets a form after an action completes, which
 * puts a select back on its first option while state still holds the saved
 * one (CLAUDE.md, College Apps gotcha).
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
  const [metric, setMetric] = useState<string>(initial.metric ?? "NONE");
  const [target, setTarget] = useState(initial.target ? String(initial.target) : "");
  const [prize, setPrize] = useState(initial.prize ?? "");
  const [endsOn, setEndsOn] = useState(initial.endsOn);
  const active = metric !== "NONE";
  const changesRace = active && (metric !== (initial.metric ?? "NONE") || target !== (initial.target ? String(initial.target) : ""));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        if (fd.get("communityGoalMetric") === "NONE") fd.set("communityGoalMetric", "");
        startTransition(() => submit(fd));
      }}
      className="flex flex-col gap-4"
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.success && !pending && (
        <p role="status" className="text-sm text-muted-foreground">
          Saved. Students see it on School Community now.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="communityGoalMetric">The school is counting</Label>
          <Select name="communityGoalMetric" value={metric} onValueChange={(v) => setMetric(v ?? "NONE")}>
            <SelectTrigger id="communityGoalMetric" className="w-full">
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
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="communityGoalTarget">Target</Label>
          <Input
            id="communityGoalTarget"
            name="communityGoalTarget"
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="e.g. 5000"
            disabled={!active}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="communityGoalPrize">Prize (optional)</Label>
        <Input
          id="communityGoalPrize"
          name="communityGoalPrize"
          maxLength={120}
          value={prize}
          onChange={(e) => setPrize(e.target.value)}
          placeholder="e.g. Pizza party for the whole school"
          disabled={!active}
        />
        <p className="text-xs text-muted-foreground">
          Shown to every student beside the progress bar. Only promise what the school will actually give.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="communityGoalEndsAt">Deadline (optional)</Label>
        <Input
          id="communityGoalEndsAt"
          name="communityGoalEndsAt"
          type="date"
          value={endsOn}
          onChange={(e) => setEndsOn(e.target.value)}
          className="w-fit"
          disabled={!active}
        />
        <p className="text-xs text-muted-foreground">Counts through the end of that day, Central time.</p>
      </div>

      {changesRace && initial.metric && (
        <p className="text-sm text-muted-foreground">
          Changing what&apos;s counted or the target starts a new goal: progress restarts from today. Changing only the
          prize or the deadline keeps the progress.
        </p>
      )}

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Saving…" : "Save goal"}
      </Button>
    </form>
  );
}
