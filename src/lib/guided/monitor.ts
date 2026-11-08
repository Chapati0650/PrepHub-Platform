import { AWAY_AFTER_MS, INDIVIDUAL_PRACTICE } from "./config";

/**
 * The teacher's monitor for an individual practice session. Pure: the
 * database rows in, one row per student and the class totals out.
 *
 * A student's state, first match wins:
 * - NOT_HERE: hasn't joined.
 * - DONE: answered every question dealt to them (even if they have since
 *   closed the laptop).
 * - AWAY: their screen has gone quiet or the tab is hidden.
 * - NEEDS_HELP: the last few answers in a row were wrong
 *   (`INDIVIDUAL_PRACTICE.strugglingStreak`).
 * - IDLE: here, but no answer for `idleAfterMs`, counted from their last
 *   answer or from joining.
 * - WORKING: everything else.
 */

export type MonitorState = "NOT_HERE" | "AWAY" | "NEEDS_HELP" | "IDLE" | "WORKING" | "DONE";

export type MonitorParticipantInput = { studentId: string; joinedAt: Date; lastSeenAt: Date; hidden: boolean };
export type MonitorSlotInput = {
  studentId: string;
  position: number;
  bonus: boolean;
  answeredAt: Date | null;
  isCorrect: boolean | null;
  /** The skill of this question, for "now on". */
  skill?: string;
};

export type MonitorRow = {
  studentId: string;
  name: string;
  state: MonitorState;
  answered: number;
  correct: number;
  total: number;
  /** 1-based number of the question they're on, or null if none left. */
  current: number | null;
  currentSkill: string | null;
  /** Milliseconds since their last answer (or joining), for "quiet for". */
  quietMs: number | null;
};

export type MonitorTotals = {
  joined: number;
  done: number;
  idle: number;
  needsHelp: number;
  away: number;
  answered: number;
  correct: number;
  /** Share right across everyone's answers so far, or null with none. */
  accuracy: number | null;
};

export function trailingWrong(answers: { isCorrect: boolean | null }[]): number {
  let n = 0;
  for (let i = answers.length - 1; i >= 0 && answers[i].isCorrect === false; i--) n++;
  return n;
}

export function buildMonitor(params: {
  roster: { studentId: string; name: string }[];
  participants: MonitorParticipantInput[];
  slots: MonitorSlotInput[];
  now: number;
  awayAfterMs?: number;
  idleAfterMs?: number;
  streak?: number;
}): { rows: MonitorRow[]; totals: MonitorTotals } {
  const awayAfter = params.awayAfterMs ?? AWAY_AFTER_MS;
  const idleAfter = params.idleAfterMs ?? INDIVIDUAL_PRACTICE.idleAfterMs;
  const streak = params.streak ?? INDIVIDUAL_PRACTICE.strugglingStreak;
  const participantOf = new Map(params.participants.map((p) => [p.studentId, p]));

  const rows: MonitorRow[] = params.roster.map((student) => {
    const p = participantOf.get(student.studentId);
    const mine = params.slots
      .filter((s) => s.studentId === student.studentId && !s.bonus)
      .sort((a, b) => a.position - b.position);
    const answeredSlots = mine.filter((s) => s.answeredAt !== null);
    const next = mine.find((s) => s.answeredAt === null) ?? null;
    const lastAnswer = answeredSlots.reduce<number | null>((m, s) => Math.max(m ?? 0, s.answeredAt!.getTime()), null);
    const lastActivity = lastAnswer ?? p?.joinedAt.getTime() ?? null;
    const quietMs = lastActivity === null ? null : Math.max(0, params.now - lastActivity);

    let state: MonitorState;
    if (!p) state = "NOT_HERE";
    else if (mine.length > 0 && answeredSlots.length >= mine.length) state = "DONE";
    else if (p.hidden || params.now - p.lastSeenAt.getTime() > awayAfter) state = "AWAY";
    else if (trailingWrong(answeredSlots) >= streak) state = "NEEDS_HELP";
    else if (quietMs !== null && quietMs > idleAfter) state = "IDLE";
    else state = "WORKING";

    return {
      studentId: student.studentId,
      name: student.name,
      state,
      answered: answeredSlots.length,
      correct: answeredSlots.filter((s) => s.isCorrect).length,
      total: mine.length,
      current: next ? mine.indexOf(next) + 1 : null,
      currentSkill: next?.skill ?? null,
      quietMs: p ? quietMs : null,
    };
  });

  const answered = rows.reduce((a, r) => a + r.answered, 0);
  const correct = rows.reduce((a, r) => a + r.correct, 0);
  const count = (state: MonitorState) => rows.filter((r) => r.state === state).length;
  return {
    rows,
    totals: {
      joined: rows.filter((r) => r.state !== "NOT_HERE").length,
      done: count("DONE"),
      idle: count("IDLE"),
      needsHelp: count("NEEDS_HELP"),
      away: count("AWAY"),
      answered,
      correct,
      accuracy: answered > 0 ? correct / answered : null,
    },
  };
}
