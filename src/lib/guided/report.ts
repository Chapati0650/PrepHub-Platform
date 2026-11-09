import type { GuidedItemKind, GuidedPace } from "@/generated/prisma/client";
import { answerBreakdown, correctLabel, type AnswerBreakdown, type AssignedQuestionKey } from "@/lib/teacher/answer-stats";

/**
 * What a session showed, for the teacher afterwards. Pure.
 *
 * It leads with what students answered alone. A second vote can overstate how
 * much a room learned (Vickrey et al. 2015); the first vote, a question like
 * the one just explained, and each student's own questions are the honest
 * measures. Catch-up answers given after the session are kept out of the room's
 * figures, which describe the room as it was.
 */

export type ReportItem = {
  id: string;
  position: number;
  kind: GuidedItemKind;
  key: AssignedQuestionKey;
  talked: boolean;
};

export type ReportResponse = {
  itemId: string;
  studentId: string;
  firstAnswer: string | null;
  firstCorrect: boolean | null;
  secondAnswer: string | null;
  secondCorrect: boolean | null;
  catchUp: boolean;
};

export type ReportOwnSlot = { studentId: string; isCorrect: boolean | null; bonus: boolean };
export type ReportParticipant = { studentId: string; pace: GuidedPace | null };
export type ReportStudent = { studentId: string; name: string };

export type ReportQuestion = {
  itemId: string;
  kind: GuidedItemKind;
  /** "Warm-up", "Question 2", "Follow-up to question 3". */
  label: string;
  correctAnswer: string;
  firstAnswered: number;
  firstRight: number | null;
  secondAnswered: number | null;
  secondRight: number | null;
  first: AnswerBreakdown;
  second: AnswerBreakdown | null;
};

export type SessionReport = {
  joined: number;
  questions: ReportQuestion[];
  /** Average right on students' own questions (bonus excluded), among those who answered any. */
  ownAverage: number | null;
  ownTotal: number;
  /** Missed a class question on their final vote and two or more of their own, or most of their own. */
  checkIn: ReportStudent[];
  absent: { student: ReportStudent; caughtUp: boolean }[];
  pace: Record<GuidedPace, number>;
};

function share(right: number, of: number): number | null {
  return of > 0 ? right / of : null;
}

/**
 * Whether the room actually saw a question: the warm-up once its answer was
 * shown, a class question once the teacher opened it. A question the teacher
 * skipped never appears in a recap, a catch-up or a report.
 */
export function reachedItem(item: { kind: GuidedItemKind; openedAt: Date | null; revealedAt: Date | null }): boolean {
  if (item.kind === "WARMUP") return item.revealedAt !== null;
  if (item.kind === "EXAMPLE") return false;
  return item.openedAt !== null;
}

export function itemLabels(items: { id: string; kind: GuidedItemKind }[]): Map<string, string> {
  const labels = new Map<string, string>();
  let classNumber = 0;
  for (const item of items) {
    if (item.kind === "WARMUP") labels.set(item.id, "Warm-up");
    else if (item.kind === "EXAMPLE") labels.set(item.id, "Worked example");
    else if (item.kind === "CLASS") labels.set(item.id, `Question ${++classNumber}`);
    else labels.set(item.id, `Follow-up to question ${classNumber}`);
  }
  return labels;
}

export function buildReport(params: {
  items: ReportItem[];
  responses: ReportResponse[];
  ownSlots: ReportOwnSlot[];
  participants: ReportParticipant[];
  roster: ReportStudent[];
}): SessionReport {
  const { responses, ownSlots, participants, roster } = params;
  const items = [...params.items].sort((a, b) => a.position - b.position);
  const labels = itemLabels(items);
  const live = responses.filter((r) => !r.catchUp);
  const joinedIds = new Set(participants.map((p) => p.studentId));

  const questions: ReportQuestion[] = items
    .filter((item) => item.kind !== "EXAMPLE")
    .map((item) => {
      const rs = live.filter((r) => r.itemId === item.id);
      const firsts = rs.filter((r) => r.firstAnswer !== null);
      const seconds = item.talked ? rs.filter((r) => r.secondAnswer !== null) : [];
      return {
        itemId: item.id,
        kind: item.kind,
        label: labels.get(item.id) ?? "",
        correctAnswer: correctLabel(item.key),
        firstAnswered: firsts.length,
        firstRight: share(firsts.filter((r) => r.firstCorrect).length, firsts.length),
        secondAnswered: item.talked ? seconds.length : null,
        secondRight: item.talked ? share(seconds.filter((r) => r.secondCorrect).length, seconds.length) : null,
        first: answerBreakdown(item.key, firsts.map((r) => ({ answer: r.firstAnswer, isCorrect: r.firstCorrect }))),
        second: item.talked
          ? answerBreakdown(item.key, seconds.map((r) => ({ answer: r.secondAnswer, isCorrect: r.secondCorrect })))
          : null,
      };
    });

  // Each student's share right on their own questions.
  const ownByStudent = new Map<string, { right: number; answered: number }>();
  for (const slot of ownSlots) {
    if (slot.bonus || slot.isCorrect === null) continue;
    const entry = ownByStudent.get(slot.studentId) ?? { right: 0, answered: 0 };
    entry.answered++;
    if (slot.isCorrect) entry.right++;
    ownByStudent.set(slot.studentId, entry);
  }
  const perStudent = new Map<string, number>();
  for (const slot of ownSlots) if (!slot.bonus) perStudent.set(slot.studentId, (perStudent.get(slot.studentId) ?? 0) + 1);
  const ownTotal = Math.max(0, ...perStudent.values());
  const ownStudents = [...ownByStudent.values()];
  const ownAverage = ownStudents.length > 0 ? ownStudents.reduce((a, s) => a + s.right, 0) / ownStudents.length : null;

  const classItemIds = new Set(items.filter((i) => i.kind === "CLASS" || i.kind === "TWIN").map((i) => i.id));
  const talkedIds = new Set(items.filter((i) => i.talked).map((i) => i.id));
  const checkIn = roster.filter((student) => {
    if (!joinedIds.has(student.studentId)) return false;
    const missedClass = live.some((r) => {
      if (r.studentId !== student.studentId || !classItemIds.has(r.itemId)) return false;
      const finalCorrect = talkedIds.has(r.itemId) && r.secondAnswer !== null ? r.secondCorrect : r.firstCorrect;
      return r.firstAnswer !== null && finalCorrect === false;
    });
    const own = ownByStudent.get(student.studentId);
    // Also anyone who got most of their own questions wrong, whatever happened with the room: a student
    // with 0 of 4 alone was left off when they'd only missed the warm-up (review, 2026-11-09).
    const struggledAlone = !!own && own.answered >= 3 && own.right <= Math.floor(own.answered / 4);
    return (missedClass && !!own && own.answered - own.right >= 2) || struggledAlone;
  });

  const answerableIds = items.filter((i) => i.kind !== "EXAMPLE").map((i) => i.id);
  const absent = roster
    .filter((s) => !joinedIds.has(s.studentId))
    .map((student) => ({
      student,
      caughtUp:
        answerableIds.length > 0 &&
        answerableIds.every((id) =>
          responses.some((r) => r.studentId === student.studentId && r.itemId === id && (r.firstAnswer !== null || r.secondAnswer !== null)),
        ),
    }));

  const pace: Record<GuidedPace, number> = { TOO_FAST: 0, ABOUT_RIGHT: 0, TOO_SLOW: 0 };
  for (const p of participants) if (p.pace) pace[p.pace]++;

  return {
    joined: participants.length,
    questions,
    ownAverage,
    ownTotal,
    checkIn,
    absent,
    pace,
  };
}
