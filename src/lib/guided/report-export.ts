import { CONFIDENCE_PATTERN_LABELS, type StudentRow } from "./student-report";

/**
 * The per-student report as CSV rows (for `toCsv`). Summary: one row per
 * student. Detail: one row per student per question, the drill-down flattened.
 */

const percent = (v: number | null) => (v === null ? "" : String(Math.round(v * 100)));
const minutes = (ms: number | null) => (ms === null ? "" : (Math.round(ms / 6000) / 10).toFixed(1));
const result = (v: boolean | null) => (v === null ? "" : v ? "Right" : "Wrong");
const confidenceWord = (c: string | null) => (c === "SURE" ? "Sure" : c === "THINK_SO" ? "Think so" : c === "GUESSING" ? "Guessing" : "");

export function studentSummaryRows(students: StudentRow[]): string[][] {
  return [
    [
      "Student",
      "Here",
      "Questions answered",
      "First try right (%)",
      "Final right (%)",
      "Sure",
      "Think so",
      "Guessing",
      "Confidence pattern",
      "Own questions right",
      "Own questions answered",
      "Own questions dealt",
      "Caught up later",
      "Time on task (minutes)",
    ],
    ...students.map((s) => [
      s.name,
      s.attended ? "Yes" : "No",
      String(s.answered),
      percent(s.firstTryPct),
      percent(s.finalPct),
      String(s.confidence.sure),
      String(s.confidence.thinkSo),
      String(s.confidence.guessing),
      s.attended ? CONFIDENCE_PATTERN_LABELS[s.confidencePattern] : "",
      String(s.own.right),
      String(s.own.answered),
      String(s.own.total),
      String(s.caughtUp),
      minutes(s.timeOnTaskMs),
    ]),
  ];
}

export function studentDetailRows(students: StudentRow[]): string[][] {
  return [
    ["Student", "Question", "Skill", "Their answer", "Second answer", "Right answer", "First try", "Final", "Confidence", "Notes"],
    ...students.flatMap((s) =>
      s.drill.map((d) => [
        s.name,
        d.label,
        d.skill ?? "",
        d.answer ?? "",
        d.secondAnswer ?? "",
        d.correctAnswer,
        result(d.firstCorrect),
        result(d.finalCorrect),
        confidenceWord(d.confidence),
        d.notes.join("; "),
      ]),
    ),
  ];
}
