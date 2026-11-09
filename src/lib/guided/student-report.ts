import type { GuidedConfidence, GuidedItemKind } from "@/generated/prisma/client";
import { answerLabel, correctLabel, type AssignedQuestionKey } from "@/lib/teacher/answer-stats";
import { STUDENT_REPORT } from "./config";

/**
 * One row per student for the teacher's report on a finished session, and the
 * drill-down behind it. Pure. Works for both session modes: a teacher-led
 * session has class questions plus each student's own questions; an
 * individual practice session has only the latter.
 *
 * What the figures mean:
 * - **Answered** counts the questions a student answered live: the warm-up,
 *   class questions and "one like it" questions, plus their own questions
 *   (bonus excluded, as everywhere else). Answers given afterwards in the
 *   catch-up are listed in the drill-down but are not part of the figures,
 *   which describe the session as it happened.
 * - **First try** is right on the first answer given, before any discussion.
 * - **Final** is right on the last answer given in the session: the second
 *   vote where the room talked and voted again, otherwise the first.
 * - **Own score** is right out of answered on the student's own questions.
 * - **Time on task** adds up the gaps between a student's timestamps (joining,
 *   every answer), counting any gap longer than `timeGapCapMs` as that long.
 */

export type StudentItem = {
  id: string;
  position: number;
  kind: GuidedItemKind;
  label: string;
  key: AssignedQuestionKey;
  talked: boolean;
  /** The question's skill, for the drill-down and the CSV (class questions share the session's skill, the warm-up may not). */
  skill?: string | null;
};

export type StudentResponseInput = {
  itemId: string;
  studentId: string;
  firstAnswer: string | null;
  firstCorrect: boolean | null;
  firstAt: Date | null;
  secondAnswer: string | null;
  secondCorrect: boolean | null;
  secondAt: Date | null;
  confidence: GuidedConfidence | null;
  catchUp: boolean;
  enteredByTeacher: boolean;
};

export type StudentOwnInput = {
  studentId: string;
  position: number;
  bonus: boolean;
  key: AssignedQuestionKey;
  skill: string;
  difficulty: string;
  answer: string | null;
  isCorrect: boolean | null;
  answeredAt: Date | null;
  retryAnswer: string | null;
  retryCorrect: boolean | null;
};

export type StudentParticipantInput = { studentId: string; joinedAt: Date };

export type ConfidencePattern = "NONE" | "SURE_BUT_WRONG" | "RIGHT_BUT_UNSURE" | "WELL_CALIBRATED";

export const CONFIDENCE_PATTERN_LABELS: Record<ConfidencePattern, string> = {
  NONE: "Not enough ratings",
  SURE_BUT_WRONG: "Sure but wrong",
  RIGHT_BUT_UNSURE: "Right but unsure",
  WELL_CALIBRATED: "Well calibrated",
};

export type ConfidenceCounts = { sure: number; thinkSo: number; guessing: number; sureWrong: number; unsureRight: number };

export type DrillRow = {
  group: "TOGETHER" | "OWN";
  label: string;
  skill: string | null;
  correctAnswer: string;
  /** Their first answer as a letter or typed value, or null if none. */
  answer: string | null;
  /** The second vote, where the room talked and voted again. */
  secondAnswer: string | null;
  firstCorrect: boolean | null;
  finalCorrect: boolean | null;
  confidence: GuidedConfidence | null;
  /** "Caught up later", "Entered by teacher", "Bonus", "Retried: B (right)". */
  notes: string[];
};

export type StudentRow = {
  studentId: string;
  name: string;
  attended: boolean;
  answered: number;
  firstTryRight: number;
  finalRight: number;
  firstTryPct: number | null;
  finalPct: number | null;
  confidence: ConfidenceCounts;
  confidencePattern: ConfidencePattern;
  own: { answered: number; right: number; total: number };
  /** Questions answered in the catch-up after the session. */
  caughtUp: number;
  timeOnTaskMs: number | null;
  drill: DrillRow[];
};

export type StudentsSummary = {
  attended: number;
  absent: number;
  /** Mean of attended students' percentages (students with at least one answer). */
  avgFirstTryPct: number | null;
  avgFinalPct: number | null;
  avgOwnPct: number | null;
  medianTimeOnTaskMs: number | null;
  /** Students in the "sure but wrong" pattern. */
  sureButWrong: number;
};

const pct = (right: number, of: number): number | null => (of > 0 ? right / of : null);

export function confidencePattern(counts: ConfidenceCounts): ConfidencePattern {
  const rated = counts.sure + counts.thinkSo + counts.guessing;
  if (rated < STUDENT_REPORT.minConfidenceRatings) return "NONE";
  // Two or more confident misses, not one (review, 2026-11-09: one "sure" miss in three ratings read as a pattern).
  if (counts.sureWrong >= 2 && counts.sureWrong / rated >= STUDENT_REPORT.sureWrongShare) return "SURE_BUT_WRONG";
  if (counts.unsureRight / rated >= STUDENT_REPORT.unsureRightShare) return "RIGHT_BUT_UNSURE";
  return "WELL_CALIBRATED";
}

/** Sum of gaps between sorted timestamps, each gap capped. Null with no timestamps. */
export function timeOnTask(timestamps: Date[], capMs: number = STUDENT_REPORT.timeGapCapMs): number | null {
  if (timestamps.length === 0) return null;
  const sorted = timestamps.map((t) => t.getTime()).sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < sorted.length; i++) total += Math.min(sorted[i] - sorted[i - 1], capMs);
  return total;
}

export function buildStudentRows(params: {
  items: StudentItem[];
  responses: StudentResponseInput[];
  ownSlots: StudentOwnInput[];
  participants: StudentParticipantInput[];
  roster: { studentId: string; name: string }[];
}): StudentRow[] {
  const items = [...params.items].sort((a, b) => a.position - b.position);
  const participantOf = new Map(params.participants.map((p) => [p.studentId, p]));

  return params.roster.map((student) => {
    const participant = participantOf.get(student.studentId);
    const mine = params.responses.filter((r) => r.studentId === student.studentId);
    const drill: DrillRow[] = [];
    const stamps: Date[] = participant ? [participant.joinedAt] : [];
    const confidence: ConfidenceCounts = { sure: 0, thinkSo: 0, guessing: 0, sureWrong: 0, unsureRight: 0 };
    let answered = 0;
    let firstTryRight = 0;
    let finalRight = 0;
    let caughtUp = 0;

    for (const item of items) {
      const r = mine.find((x) => x.itemId === item.id);
      const gaveAny = !!r && (r.firstAnswer !== null || r.secondAnswer !== null);
      const useSecond = !!r && item.talked && r.secondAnswer !== null;
      const finalCorrect = !r || !gaveAny ? null : useSecond ? r.secondCorrect : r.firstCorrect;
      const notes: string[] = [];
      if (r?.catchUp) notes.push("Caught up later");
      if (r?.enteredByTeacher) notes.push("Entered by teacher");
      drill.push({
        group: "TOGETHER",
        label: item.label,
        skill: item.skill ?? null,
        correctAnswer: correctLabel(item.key),
        answer: r?.firstAnswer ? answerLabel(item.key, r.firstAnswer) : null,
        secondAnswer: item.talked && r?.secondAnswer ? answerLabel(item.key, r.secondAnswer) : null,
        firstCorrect: r?.firstCorrect ?? null,
        finalCorrect,
        confidence: r?.confidence ?? null,
        notes,
      });
      if (!r || !gaveAny) continue;
      if (r.catchUp) {
        caughtUp++;
        continue;
      }
      answered++;
      if (r.firstCorrect) firstTryRight++;
      if (finalCorrect) finalRight++;
      if (r.firstAt) stamps.push(r.firstAt);
      if (r.secondAt) stamps.push(r.secondAt);
      if (r.confidence && r.firstAnswer !== null && item.kind !== "WARMUP") {
        if (r.confidence === "SURE") confidence.sure++;
        else if (r.confidence === "THINK_SO") confidence.thinkSo++;
        else confidence.guessing++;
        if (r.confidence === "SURE" && r.firstCorrect === false) confidence.sureWrong++;
        if (r.confidence !== "SURE" && r.firstCorrect) confidence.unsureRight++;
      }
    }

    const own = params.ownSlots.filter((s) => s.studentId === student.studentId).sort((a, b) => a.position - b.position);
    const ownMain = own.filter((s) => !s.bonus);
    let ownNumber = 0;
    for (const slot of own) {
      const label = slot.bonus ? "Bonus question" : `Own question ${++ownNumber}`;
      const notes: string[] = [];
      if (slot.bonus) notes.push("Bonus");
      if (slot.retryAnswer !== null) {
        notes.push(`Tried again later: ${answerLabel(slot.key, slot.retryAnswer)} (${slot.retryCorrect ? "right" : "wrong"})`);
      }
      drill.push({
        group: "OWN",
        label,
        skill: slot.skill,
        correctAnswer: correctLabel(slot.key),
        answer: slot.answer !== null ? answerLabel(slot.key, slot.answer) : null,
        secondAnswer: null,
        firstCorrect: slot.answer !== null ? slot.isCorrect : null,
        finalCorrect: slot.answer !== null ? slot.isCorrect : null,
        confidence: null,
        notes,
      });
      if (slot.answeredAt) stamps.push(slot.answeredAt);
      if (slot.bonus || slot.answer === null) continue;
      answered++;
      if (slot.isCorrect) {
        firstTryRight++;
        finalRight++;
      }
    }
    const ownAnswered = ownMain.filter((s) => s.answer !== null);

    return {
      studentId: student.studentId,
      name: student.name,
      // Anyone with a live answer took part, as the class report counts them, even without a joined row.
      attended: !!participant || answered > 0,
      answered,
      firstTryRight,
      finalRight,
      firstTryPct: pct(firstTryRight, answered),
      finalPct: pct(finalRight, answered),
      confidence,
      confidencePattern: confidencePattern(confidence),
      own: { answered: ownAnswered.length, right: ownAnswered.filter((s) => s.isCorrect).length, total: ownMain.length },
      caughtUp,
      timeOnTaskMs: timeOnTask(stamps),
      drill,
    };
  });
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function summarizeStudents(rows: StudentRow[]): StudentsSummary {
  const attended = rows.filter((r) => r.attended);
  const times = attended.map((r) => r.timeOnTaskMs).filter((t): t is number => t !== null).sort((a, b) => a - b);
  const mid = Math.floor(times.length / 2);
  return {
    attended: attended.length,
    absent: rows.length - attended.length,
    avgFirstTryPct: mean(attended.map((r) => r.firstTryPct).filter((v): v is number => v !== null)),
    avgFinalPct: mean(attended.map((r) => r.finalPct).filter((v): v is number => v !== null)),
    avgOwnPct: mean(attended.filter((r) => r.own.answered > 0).map((r) => r.own.right / r.own.answered)),
    medianTimeOnTaskMs: times.length === 0 ? null : times.length % 2 === 1 ? times[mid] : (times[mid - 1] + times[mid]) / 2,
    sureButWrong: attended.filter((r) => r.confidencePattern === "SURE_BUT_WRONG").length,
  };
}

export type SortKey = "name" | "attended" | "answered" | "firstTryPct" | "finalPct" | "confidence" | "own" | "time";
export type SortDirection = "asc" | "desc";

const PATTERN_ORDER: Record<ConfidencePattern, number> = { SURE_BUT_WRONG: 0, RIGHT_BUT_UNSURE: 1, WELL_CALIBRATED: 2, NONE: 3 };

function sortValue(row: StudentRow, key: SortKey): number | string | null {
  switch (key) {
    case "name":
      return row.name.toLowerCase();
    case "attended":
      return row.attended ? 1 : 0;
    case "answered":
      return row.answered;
    case "firstTryPct":
      return row.firstTryPct;
    case "finalPct":
      return row.finalPct;
    case "confidence":
      return PATTERN_ORDER[row.confidencePattern];
    case "own":
      return row.own.answered > 0 ? row.own.right / row.own.answered : null;
    case "time":
      return row.timeOnTaskMs;
  }
}

/** Sorted copy. Students with no value for the column go last whichever way it's sorted; ties keep roster order. */
export function sortStudentRows(rows: StudentRow[], key: SortKey, direction: SortDirection): StudentRow[] {
  const sign = direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, key) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      if (a.value < b.value) return -1 * sign;
      if (a.value > b.value) return 1 * sign;
      return a.index - b.index;
    })
    .map((x) => x.row);
}
