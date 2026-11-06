import type { ExtraTime, GuidedConfidence, GuidedItemKind, GuidedPhase, GuidedSessionStatus, QuestionDifficulty } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import type { TeacherContext } from "@/lib/teacher/access";
import { answerBreakdown, answerLabel, type AnswerBreakdown } from "@/lib/teacher/answer-stats";
import { formatJoinCode } from "@/lib/teacher/join-code";
import { compareRosterNames, studentRosterName } from "@/lib/teacher/names";
import { AWAY_AFTER_MS, VERY_FAST_MS } from "./config";
import { answerKeyOf, loadRevisions } from "./content";
import { requireOwnedSession } from "./control";
import { suggestMove, type SuggestedMove } from "./plan";
import { buildReport, itemLabels, reachedItem, type SessionReport } from "./report";
import { itemForPhase } from "./state";

/**
 * The teacher's own screen. Unlike the board, this one names students: the
 * teacher sees who has answered and what, live, on their laptop only, and
 * only for this session's questions (the same boundary as homework: a teacher
 * sees results on work they give their class, and nothing else from a
 * student's account). Nothing here is ever sent to the projector.
 */

export type RosterState = "NOT_HERE" | "PAPER" | "AWAY" | "ANSWERED" | "WORKING" | "DONE";

export type ConsoleStudent = {
  studentId: string;
  name: string;
  state: RosterState;
  extraTime: ExtraTime;
  first: string | null;
  firstCorrect: boolean | null;
  second: string | null;
  secondCorrect: boolean | null;
  confidence: GuidedConfidence | null;
  veryFast: boolean;
  own: { answered: number; right: number; total: number } | null;
};

export type ConsoleItem = {
  id: string;
  kind: GuidedItemKind;
  label: string;
  difficulty: QuestionDifficulty;
  plannedChance: number | null;
  correctLabel: string;
  stepTotal: number;
  first: AnswerBreakdown;
  second: AnswerBreakdown | null;
  firstRight: number | null;
  suggestion: SuggestedMove | null;
  confidence: Record<GuidedConfidence, number>;
  /** Students sure of a wrong answer: worth listening for. */
  sureWrong: number;
  talked: boolean;
};

export type ConsoleState = {
  sessionId: string;
  classroomId: string;
  className: string;
  categoryLabel: string;
  joinCode: string;
  stateKey: string;
  version: number;
  status: GuidedSessionStatus;
  phase: GuidedPhase;
  paused: boolean;
  step: number;
  serverNow: number;
  phaseEndsAt: number | null;
  item: ConsoleItem | null;
  hasNextQuestion: boolean;
  classQuestionNumber: number | null;
  classQuestionCount: number;
  roster: ConsoleStudent[];
  joined: number;
  ownFinished: number;
};

const ANSWERABLE: GuidedItemKind[] = ["CLASS", "TWIN"];

export async function getConsoleState(context: TeacherContext, sessionId: string, now: Date = new Date()): Promise<ConsoleState> {
  const session = await requireOwnedSession(context, sessionId);
  const current = itemForPhase(session.phase, session.position, session.items);
  const labels = itemLabels(session.items);
  const [enrollments, participants, responses, ownSlots] = await Promise.all([
    prisma.classroomEnrollment.findMany({
      where: { classroomId: session.classroomId, removedAt: null },
      select: { studentId: true, lastName: true, extraTime: true, student: { select: { firstName: true } } },
    }),
    prisma.guidedParticipant.findMany({ where: { sessionId } }),
    current ? prisma.guidedResponse.findMany({ where: { itemId: current.id, catchUp: false } }) : Promise.resolve([]),
    session.phase === "OWN" || session.phase === "RECAP"
      ? prisma.guidedOwnSlot.findMany({ where: { sessionId, bonus: false }, select: { studentId: true, answer: true, isCorrect: true } })
      : Promise.resolve([]),
  ]);

  const info = current ? (await loadRevisions([current.questionRevisionId])).get(current.questionRevisionId)! : null;
  const key = info ? answerKeyOf(info) : null;
  const participantOf = new Map(participants.map((p) => [p.studentId, p]));
  const responseOf = new Map(responses.map((r) => [r.studentId, r]));
  const ownOf = new Map<string, { answered: number; right: number; total: number }>();
  for (const slot of ownSlots) {
    const e = ownOf.get(slot.studentId) ?? { answered: 0, right: 0, total: 0 };
    e.total++;
    if (slot.answer !== null) e.answered++;
    if (slot.isCorrect) e.right++;
    ownOf.set(slot.studentId, e);
  }
  const answerVote = session.phase === "REVOTE" || (current?.talked && (session.phase === "REVEAL" || session.phase === "EXPLAIN")) ? 2 : 1;

  const roster: ConsoleStudent[] = enrollments
    .map((e) => ({ ...e, firstName: e.student.firstName }))
    .sort(compareRosterNames)
    .map((e) => {
      const p = participantOf.get(e.studentId);
      const r = responseOf.get(e.studentId);
      const own = ownOf.get(e.studentId) ?? null;
      let state: RosterState;
      if (!p) state = "NOT_HERE";
      else if (p.onPaper) state = "PAPER";
      else if (p.hidden || now.getTime() - p.lastSeenAt.getTime() > AWAY_AFTER_MS) state = "AWAY";
      else if (session.phase === "OWN" || session.phase === "RECAP") state = own && own.total > 0 && own.answered >= own.total ? "DONE" : "WORKING";
      else if (current && (answerVote === 2 ? r?.secondAnswer : r?.firstAnswer)) state = "ANSWERED";
      else state = "WORKING";
      const veryFast = !!(r?.firstAt && current?.openedAt && r.firstAt.getTime() - current.openedAt.getTime() < VERY_FAST_MS && current.kind !== "WARMUP");
      return {
        studentId: e.studentId,
        name: studentRosterName(e),
        state,
        extraTime: p?.extraTime ?? e.extraTime,
        first: key && r?.firstAnswer ? answerLabel(key, r.firstAnswer) : null,
        firstCorrect: r?.firstCorrect ?? null,
        second: key && r?.secondAnswer ? answerLabel(key, r.secondAnswer) : null,
        secondCorrect: r?.secondCorrect ?? null,
        confidence: r?.confidence ?? null,
        veryFast,
        own,
      };
    });

  let item: ConsoleItem | null = null;
  if (current && info && key) {
    const firsts = responses.filter((r) => r.firstAnswer !== null);
    const seconds = responses.filter((r) => r.secondAnswer !== null);
    const firstRight = firsts.length > 0 ? firsts.filter((r) => r.firstCorrect).length / firsts.length : null;
    const confidence: Record<GuidedConfidence, number> = { SURE: 0, THINK_SO: 0, GUESSING: 0 };
    for (const r of firsts) if (r.confidence) confidence[r.confidence]++;
    item = {
      id: current.id,
      kind: current.kind,
      label: labels.get(current.id) ?? "",
      difficulty: current.difficulty,
      plannedChance: current.plannedChance,
      correctLabel: answerLabel(key, info.choices.find((c) => c.isCorrect)?.id ?? info.acceptedAnswers[0] ?? null),
      stepTotal: info.steps.length,
      first: answerBreakdown(key, firsts.map((r) => ({ answer: r.firstAnswer, isCorrect: r.firstCorrect }))),
      second: current.talked ? answerBreakdown(key, seconds.map((r) => ({ answer: r.secondAnswer, isCorrect: r.secondCorrect }))) : null,
      firstRight,
      suggestion: ANSWERABLE.includes(current.kind) ? suggestMove(firstRight) : null,
      confidence,
      sureWrong: firsts.filter((r) => r.confidence === "SURE" && r.firstCorrect === false).length,
      talked: current.talked,
    };
  }

  const classItems = session.items.filter((i) => i.kind === "CLASS");
  return {
    sessionId,
    classroomId: session.classroomId,
    className: session.classroom.name,
    categoryLabel: CATEGORY_LABELS[session.category],
    joinCode: formatJoinCode(session.joinCode),
    stateKey: session.stateKey,
    version: session.version,
    status: session.status,
    phase: session.phase,
    paused: session.paused,
    step: session.step,
    serverNow: now.getTime(),
    phaseEndsAt: session.phaseEndsAt?.getTime() ?? null,
    item,
    hasNextQuestion: session.items.some((i) => i.position > session.position && ANSWERABLE.includes(i.kind)),
    classQuestionNumber: current?.kind === "CLASS" ? classItems.findIndex((c) => c.id === current.id) + 1 : null,
    classQuestionCount: classItems.length,
    roster,
    joined: participants.length,
    ownFinished: participants.filter((p) => p.ownFinishedAt).length,
  };
}

export type ReportPage = {
  sessionId: string;
  classroomId: string;
  className: string;
  categoryLabel: string;
  status: GuidedSessionStatus;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  rosterSize: number;
  report: SessionReport;
  /** The skill PrepHub suggested, if the teacher chose a different one. */
  suggested: string | null;
};

export async function getSessionReport(context: TeacherContext, sessionId: string): Promise<ReportPage> {
  const session = await requireOwnedSession(context, sessionId);
  const [enrollments, participants, responses, ownSlots] = await Promise.all([
    prisma.classroomEnrollment.findMany({
      where: { classroomId: session.classroomId, removedAt: null },
      select: { studentId: true, lastName: true, student: { select: { firstName: true } } },
    }),
    prisma.guidedParticipant.findMany({ where: { sessionId }, select: { studentId: true, pace: true } }),
    prisma.guidedResponse.findMany({ where: { sessionId } }),
    prisma.guidedOwnSlot.findMany({ where: { sessionId }, select: { studentId: true, isCorrect: true, bonus: true } }),
  ]);
  const infos = await loadRevisions(session.items.map((i) => i.questionRevisionId));
  const roster = enrollments
    .map((e) => ({ ...e, firstName: e.student.firstName }))
    .sort(compareRosterNames)
    .map((e) => ({ studentId: e.studentId, name: studentRosterName(e) }));
  const report = buildReport({
    items: session.items.filter(reachedItem).map((i) => ({
      id: i.id,
      position: i.position,
      kind: i.kind,
      key: answerKeyOf(infos.get(i.questionRevisionId)!),
      talked: i.talked,
    })),
    responses,
    ownSlots,
    participants,
    roster,
  });
  const snapshot = session.pickSnapshot as { suggested?: string | null } | null;
  const suggested = snapshot?.suggested && snapshot.suggested !== session.category ? CATEGORY_LABELS[snapshot.suggested as keyof typeof CATEGORY_LABELS] : null;
  return {
    sessionId,
    classroomId: session.classroomId,
    className: session.classroom.name,
    categoryLabel: CATEGORY_LABELS[session.category],
    status: session.status,
    createdAt: session.createdAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    rosterSize: enrollments.length,
    report,
    suggested,
  };
}

/** A class's sessions, newest first, for its page. */
export async function listClassSessions(classroomId: string) {
  const sessions = await prisma.guidedSession.findMany({
    where: { classroomId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      status: true,
      category: true,
      createdAt: true,
      endedAt: true,
      _count: { select: { participants: true } },
    },
  });
  return sessions.map((s) => ({
    id: s.id,
    status: s.status,
    categoryLabel: CATEGORY_LABELS[s.category],
    createdAt: s.createdAt,
    endedAt: s.endedAt,
    joined: s._count.participants,
  }));
}
