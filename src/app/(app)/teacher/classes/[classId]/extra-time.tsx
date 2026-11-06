"use client";

import { useState, useTransition } from "react";
import type { ExtraTime } from "@/generated/prisma/client";
import { EXTRA_TIME_LABELS } from "@/lib/guided/config";
import { setExtraTimeAction } from "../../live/actions";

const OPTIONS: ExtraTime[] = ["NONE", "TIME_AND_HALF", "DOUBLE"];

/**
 * A student's extended-time accommodation (504 plan or IEP), set once and
 * privately, so a student never has to ask for it in front of the class.
 * Guided Sessions read it: no countdown on their screen in the class rounds,
 * and a longer clock for their own questions.
 *
 * A controlled select saved on change (no form, so React's post-action form
 * reset can't snap it back to the first option).
 */
export function ExtraTimeSelect({
  classroomId,
  studentId,
  name,
  value,
}: {
  classroomId: string;
  studentId: string;
  name: string;
  value: ExtraTime;
}) {
  const [current, setCurrent] = useState<ExtraTime>(value);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const id = `extra-${studentId}`;
  return (
    <span className="flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        Extra time for {name}
      </label>
      <select
        id={id}
        value={current}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as ExtraTime;
          const previous = current;
          setCurrent(next);
          start(async () => {
            try {
              const r = await setExtraTimeAction(classroomId, studentId, next);
              if (!r.ok) throw new Error();
              setFailed(false);
            } catch {
              setCurrent(previous);
              setFailed(true);
            }
          });
        }}
        className="h-11 rounded-md border border-border bg-background px-3 text-base"
      >
        {OPTIONS.map((o) => (
          <option key={o} value={o}>
            {EXTRA_TIME_LABELS[o]}
          </option>
        ))}
      </select>
      {failed && <span className="text-sm text-destructive">Not saved. Try again.</span>}
    </span>
  );
}
