"use client";

import { Fragment, useMemo, useState } from "react";
import { StatusChip } from "@/components/staff/staff-ui";
import {
  CONFIDENCE_PATTERN_LABELS,
  sortStudentRows,
  type DrillRow,
  type SortDirection,
  type SortKey,
  type StudentRow,
} from "@/lib/guided/student-report";

const pct = (v: number | null) =>
  v === null ? "—" : `${Math.round(v * 100)}%`;

function minutes(ms: number | null): string {
  if (ms === null) return "—";
  const m = Math.round(ms / 60_000);
  return m < 1 ? "Under 1 min" : `${m} min`;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Student" },
  { key: "attended", label: "Here" },
  { key: "answered", label: "Answered" },
  { key: "firstTryPct", label: "First try right" },
  { key: "finalPct", label: "Final right" },
  { key: "confidence", label: "Confidence" },
  { key: "own", label: "Own questions" },
  { key: "time", label: "Time on task" },
];

function mark(correct: boolean | null): string {
  return correct === null ? "—" : correct ? "Right" : "Wrong";
}

function Drill({ rows, name }: { rows: DrillRow[]; name: string }) {
  if (rows.length === 0)
    return (
      <p className="p-4 text-base text-muted-foreground">
        No questions to show.
      </p>
    );
  return (
    <table className="w-full text-left text-base">
      <caption className="sr-only">Every question for {name}</caption>
      <thead className="text-sm text-muted-foreground">
        <tr>
          <th scope="col" className="p-2 font-medium">
            Question
          </th>
          <th scope="col" className="p-2 font-medium">
            Their answer
          </th>
          <th scope="col" className="p-2 font-medium">
            Right answer
          </th>
          <th scope="col" className="p-2 font-medium">
            Result
          </th>
          <th scope="col" className="p-2 font-medium">
            Confidence
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((d, i) => (
          <Fragment key={i}>
            {(i === 0 || rows[i - 1].group !== d.group) && (
              <tr className="bg-surface-tint">
                <th
                  scope="colgroup"
                  colSpan={5}
                  className="p-2 text-sm font-semibold"
                >
                  {d.group === "TOGETHER"
                    ? "Class questions (answered together, with a second vote where the room talked)"
                    : "Their own questions (answered alone)"}
                </th>
              </tr>
            )}
            <tr>
              <th scope="row" className="p-2 font-medium">
                {d.label}
                {d.skill && (
                  <span className="block text-sm font-normal text-muted-foreground">
                    {d.skill}
                  </span>
                )}
                {d.notes.map((n) => (
                  <span
                    key={n}
                    className="block text-sm font-normal text-muted-foreground"
                  >
                    {n === "Caught up later"
                      ? "Caught up later (listed, not counted above)"
                      : n}
                  </span>
                ))}
              </th>
              <td className="p-2 tabular-nums">
                {d.answer ?? (
                  <span className="text-muted-foreground">No answer</span>
                )}
                {d.secondAnswer !== null && d.secondAnswer !== d.answer && (
                  <> → {d.secondAnswer} after talking</>
                )}
              </td>
              <td className="p-2 tabular-nums">{d.correctAnswer}</td>
              <td className="p-2">
                <span className="font-semibold">{mark(d.finalCorrect)}</span>
                {d.firstCorrect !== null &&
                  d.finalCorrect !== d.firstCorrect && (
                    <span className="block text-sm text-muted-foreground">
                      First try: {mark(d.firstCorrect).toLowerCase()}
                    </span>
                  )}
              </td>
              <td className="p-2">
                {d.confidence === "SURE"
                  ? "Sure"
                  : d.confidence === "THINK_SO"
                    ? "Think so"
                    : d.confidence === "GUESSING"
                      ? "Guessing"
                      : "—"}
              </td>
            </tr>
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

/**
 * One row per student, sortable, each opening to every question that student
 * saw: their answer(s), whether it was right, and how sure they said they
 * were. Sorting is a view over data already on the page.
 */
export function StudentResults({ rows }: { rows: StudentRow[] }) {
  const [key, setKey] = useState<SortKey>("name");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [open, setOpen] = useState<string | null>(null);
  const sorted = useMemo(
    () => sortStudentRows(rows, key, direction),
    [rows, key, direction],
  );

  function sortBy(next: SortKey) {
    if (next === key) setDirection(direction === "asc" ? "desc" : "asc");
    else {
      setKey(next);
      // Names read A to Z; every figure reads highest first.
      setDirection(next === "name" ? "asc" : "desc");
    }
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl bg-surface-tint p-5 text-base text-muted-foreground">
        There are no students in this class.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[56rem] text-left text-base">
        <caption className="sr-only">
          How each student did in this session. Use the column buttons to sort.
        </caption>
        <thead className="border-b border-border text-sm text-muted-foreground">
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                scope="col"
                className="p-3 font-medium"
                aria-sort={
                  key === c.key
                    ? direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button
                  type="button"
                  onClick={() => sortBy(c.key)}
                  className="inline-flex items-center gap-1 rounded font-medium hover:text-foreground"
                >
                  {c.label}
                  <span aria-hidden>
                    {key === c.key ? (direction === "asc" ? "↑" : "↓") : ""}
                  </span>
                </button>
              </th>
            ))}
            <th scope="col" className="p-3 font-medium">
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const expanded = open === r.studentId;
            return (
              <Fragment key={r.studentId}>
                <tr className="border-t border-border">
                  <th scope="row" className="p-3 font-semibold">
                    {r.name}
                  </th>
                  <td className="p-3">
                    {r.attended ? (
                      <StatusChip tone="good">Here</StatusChip>
                    ) : r.caughtUp > 0 ? (
                      <StatusChip tone="muted">Absent · caught up</StatusChip>
                    ) : (
                      <StatusChip tone="muted">Absent</StatusChip>
                    )}
                  </td>
                  <td className="p-3 tabular-nums">
                    {r.attended ? r.answered : "—"}
                  </td>
                  <td className="p-3 tabular-nums">
                    {r.attended ? pct(r.firstTryPct) : "—"}
                  </td>
                  <td className="p-3 tabular-nums">
                    {r.attended ? pct(r.finalPct) : "—"}
                  </td>
                  <td className="p-3">
                    {r.attended ? (
                      <>
                        {CONFIDENCE_PATTERN_LABELS[r.confidencePattern]}
                        {r.confidencePattern !== "NONE" && (
                          <span className="block text-sm text-muted-foreground">
                            {r.confidence.sure} sure · {r.confidence.thinkSo}{" "}
                            think so · {r.confidence.guessing} guessing
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3 tabular-nums">
                    {r.attended && r.own.total > 0 ? (
                      <>
                        {r.own.right} of {r.own.answered} right
                        <span className="block text-sm text-muted-foreground">
                          {r.own.total} dealt
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="whitespace-nowrap p-3 tabular-nums">
                    {r.attended ? minutes(r.timeOnTaskMs) : "—"}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      className="rounded-md border border-border px-3 py-1.5 text-base font-medium hover:bg-muted"
                      aria-expanded={expanded}
                      aria-controls={`drill-${r.studentId}`}
                      onClick={() => setOpen(expanded ? null : r.studentId)}
                    >
                      {expanded ? "Hide" : "Questions"}
                      <span className="sr-only"> for {r.name}</span>
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr
                    id={`drill-${r.studentId}`}
                    className="bg-surface-tint/50"
                  >
                    <td colSpan={COLUMNS.length + 1} className="p-3">
                      <Drill rows={r.drill} name={r.name} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
