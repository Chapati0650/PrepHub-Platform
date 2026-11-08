import type { GuidedItemKind, GuidedPhase, GuidedSessionMode, GuidedSessionStatus, QuestionCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { StudentQuestionContent } from "@/lib/session/question-content";
import { answerBreakdown, answerLabel } from "@/lib/teacher/answer-stats";
import { formatJoinCode } from "@/lib/teacher/join-code";
import { teacherName } from "@/lib/teacher/names";
import { answerKeyOf, correctChoiceId, loadRevisions, type RevisionInfo } from "./content";
import { itemLabels, reachedItem } from "./report";
import { sectionOf, type Section } from "./config";
import { sessionSkillLabel } from "./modes";

/**
 * The room, as every screen in it sees it: the projector and each student's
 * Chromebook poll this. It holds nothing about any one student, which is what
 * makes it safe to cache at the edge for a second (thirty screens then cost
 * about one database read a second), and safe to show on a projector.
 *
 * What it may contain follows the room:
 * - A question's content appears only once the teacher has opened it.
 * - How the room voted appears only at the reveal. While partners talk, even
 *   the split stays hidden: students who see the class's bar chart before
 *   discussing are about 30% more likely to switch to the most popular
 *   answer, right or wrong (Perez et al. 2010).
 */

export type SharedReveal = {
  correctChoiceId: string | null;
  acceptedAnswers: string[];
  correctLabel: string;
  firstAnswered: number;
  firstRight: number | null;
  secondAnswered: number | null;
  secondRight: number | null;
  /** Per choice, in display order (multiple choice only). */
  firstCounts: number[] | null;
  secondCounts: number[] | null;
  /** The wrong answer most of the room chose, and why it tempts people. */
  commonWrong: { label: string; choiceId: string | null; note: string | null } | null;
  /** Why each wrong choice is wrong, for students who chose it. */
  distractors: Record<string, string>;
};

export type SharedItem = {
  id: string;
  kind: GuidedItemKind;
  /** "Question 2", "Warm-up", "One like question 3". */
  label: string;
  /** 1-based among class questions; null for the warm-up and the example. */
  number: number | null;
  content: StudentQuestionContent;
  firstAnswered: number;
  secondAnswered: number;
  reveal: SharedReveal | null;
  /** Explanation steps up to the one on the board, in EXAMPLE and EXPLAIN. */
  steps: { text: string; imageId: string | null }[] | null;
  stepTotal: number;
  takeaway: string | null;
};

export type SharedRecap = {
  questions: { label: string; firstRight: number | null; secondRight: number | null; talked: boolean }[];
  ownAverage: number | null;
  ownTotal: number;
  takeaways: string[];
};

export type SharedState = {
  mode: GuidedSessionMode;
  sessionId: string;
  version: number;
  status: GuidedSessionStatus;
  phase: GuidedPhase;
  paused: boolean;
  position: number;
  step: number;
  serverNow: number;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  className: string;
  teacherName: string;
  joinCode: string;
  category: QuestionCategory;
  categoryLabel: string;
  section: Section;
  joined: number;
  rosterSize: number;
  classQuestionCount: number;
  ownQuestionCount: number;
  ownSeconds: number;
  ownFinished: number;
  item: SharedItem | null;
  recap: SharedRecap | null;
};

const MEMO_MS = 900;
const memo = new Map<string, { at: number; state: SharedState | null }>();

/** Drop this instance's cached copy after a teacher action, so the next poll here sees it at once. */
export function forgetSharedState(stateKey: string) {
  memo.delete(stateKey);
}

export async function getSharedState(stateKey: string, now: number = Date.now()): Promise<SharedState | null> {
  const hit = memo.get(stateKey);
  if (hit && now - hit.at < MEMO_MS) return hit.state;
  const state = await buildSharedState(stateKey, now);
  if (memo.size > 200) memo.clear();
  memo.set(stateKey, { at: now, state });
  return state;
}

function share(right: number, of: number): number | null {
  return of > 0 ? right / of : null;
}

async function buildSharedState(stateKey: string, now: number): Promise<SharedState | null> {
  const session = await prisma.guidedSession.findUnique({
    where: { stateKey },
    include: {
      classroom: { select: { name: true } },
      teacher: { select: { firstName: true, teacherDisplayName: true } },
      items: {
        orderBy: { position: "asc" },
        select: { id: true, kind: true, position: true, questionRevisionId: true, talked: true, openedAt: true, revealedAt: true },
      },
    },
  });
  if (!session) return null;

  const [joined, rosterSize, ownFinished] = await Promise.all([
    prisma.guidedParticipant.count({ where: { sessionId: session.id } }),
    prisma.classroomEnrollment.count({ where: { classroomId: session.classroomId, removedAt: null } }),
    session.phase === "OWN" || session.phase === "RECAP"
      ? prisma.guidedParticipant.count({ where: { sessionId: session.id, ownFinishedAt: { not: null } } })
      : Promise.resolve(0),
  ]);

  const labels = itemLabels(session.items);
  const classItems = session.items.filter((i) => i.kind === "CLASS");
  const current = itemForPhase(session.phase, session.position, session.items);

  let item: SharedItem | null = null;
  if (current && session.status === "OPEN") {
    const info = (await loadRevisions([current.questionRevisionId])).get(current.questionRevisionId)!;
    const revealed = session.phase === "REVEAL" || session.phase === "EXPLAIN";
    const responses = await prisma.guidedResponse.findMany({
      where: { itemId: current.id, catchUp: false },
      select: { firstAnswer: true, firstCorrect: true, secondAnswer: true, secondCorrect: true },
    });
    const firsts = responses.filter((r) => r.firstAnswer !== null);
    const seconds = responses.filter((r) => r.secondAnswer !== null);
    const showSteps = session.phase === "EXAMPLE" || session.phase === "EXPLAIN";
    item = {
      id: current.id,
      kind: current.kind,
      label: labels.get(current.id) ?? "",
      number: current.kind === "CLASS" ? classItems.findIndex((c) => c.id === current.id) + 1 : null,
      content: info.content,
      firstAnswered: firsts.length,
      secondAnswered: seconds.length,
      reveal: revealed ? revealFor(info, firsts, current.talked ? seconds : null) : null,
      steps: showSteps ? info.steps.slice(0, Math.min(session.step + 1, info.steps.length)) : null,
      stepTotal: info.steps.length,
      takeaway: revealed || session.phase === "EXAMPLE" ? info.takeaway : null,
    };
  }

  const recap = session.phase === "RECAP" || session.status === "ENDED" ? await recapFor(session.id, session.items, labels) : null;

  return {
    mode: session.mode,
    sessionId: session.id,
    version: session.version,
    status: session.status,
    phase: session.phase,
    paused: session.paused,
    position: session.position,
    step: session.step,
    serverNow: now,
    phaseStartedAt: session.phaseStartedAt.getTime(),
    phaseEndsAt: session.phaseEndsAt?.getTime() ?? null,
    className: session.classroom.name,
    teacherName: teacherName(session.teacher),
    joinCode: formatJoinCode(session.joinCode),
    category: session.category,
    categoryLabel: sessionSkillLabel(session),
    section: sectionOf(session.category),
    joined,
    rosterSize,
    classQuestionCount: classItems.length,
    ownQuestionCount: session.ownQuestionCount,
    ownSeconds: session.ownSeconds,
    ownFinished,
    item,
    recap,
  };
}

/** The item the room is looking at in this phase, if any. */
export function itemForPhase<T extends { kind: GuidedItemKind; position: number }>(
  phase: GuidedPhase,
  position: number,
  items: T[],
): T | null {
  if (phase === "LOBBY") return items.find((i) => i.kind === "WARMUP") ?? null;
  if (phase === "PLAN" || phase === "OWN" || phase === "RECAP") return null;
  return items.find((i) => i.position === position) ?? null;
}

function revealFor(
  info: RevisionInfo,
  firsts: { firstAnswer: string | null; firstCorrect: boolean | null }[],
  seconds: { secondAnswer: string | null; secondCorrect: boolean | null }[] | null,
): SharedReveal {
  const key = answerKeyOf(info);
  const first = answerBreakdown(key, firsts.map((r) => ({ answer: r.firstAnswer, isCorrect: r.firstCorrect })));
  const second = seconds ? answerBreakdown(key, seconds.map((r) => ({ answer: r.secondAnswer, isCorrect: r.secondCorrect }))) : null;
  const correctId = correctChoiceId(info);
  const distractors: Record<string, string> = {};
  for (const c of info.choices) if (!c.isCorrect && c.distractor) distractors[c.id] = c.distractor;

  let commonWrong: SharedReveal["commonWrong"] = null;
  if (first.kind === "choices" && first.commonWrong) {
    const index = first.choices.findIndex((c) => c.label === first.commonWrong);
    const choice = info.choices[index];
    commonWrong = { label: first.commonWrong, choiceId: choice?.id ?? null, note: choice?.distractor ?? null };
  } else if (first.kind === "entries" && first.wrong[0] && first.wrong[0].count >= 2) {
    commonWrong = { label: first.wrong[0].value, choiceId: null, note: null };
  }

  return {
    correctChoiceId: correctId,
    acceptedAnswers: info.acceptedAnswers,
    correctLabel: correctId ? answerLabel(key, correctId) : (info.acceptedAnswers[0] ?? ""),
    firstAnswered: firsts.length,
    firstRight: share(firsts.filter((r) => r.firstCorrect).length, firsts.length),
    secondAnswered: seconds ? seconds.length : null,
    secondRight: seconds ? share(seconds.filter((r) => r.secondCorrect).length, seconds.length) : null,
    firstCounts: first.kind === "choices" ? first.choices.map((c) => c.count) : null,
    secondCounts: second && second.kind === "choices" ? second.choices.map((c) => c.count) : null,
    commonWrong,
    distractors,
  };
}

async function recapFor(
  sessionId: string,
  items: { id: string; kind: GuidedItemKind; questionRevisionId: string; talked: boolean; openedAt: Date | null; revealedAt: Date | null }[],
  labels: Map<string, string>,
): Promise<SharedRecap> {
  const answerable = items.filter((i) => (i.kind === "CLASS" || i.kind === "TWIN") && reachedItem(i));
  const [responses, own, infos] = await Promise.all([
    prisma.guidedResponse.findMany({
      where: { sessionId, catchUp: false },
      select: { itemId: true, firstAnswer: true, firstCorrect: true, secondAnswer: true, secondCorrect: true },
    }),
    prisma.guidedOwnSlot.findMany({
      where: { sessionId, bonus: false },
      select: { studentId: true, isCorrect: true },
    }),
    loadRevisions(items.filter((i) => i.kind !== "WARMUP").map((i) => i.questionRevisionId)),
  ]);
  const questions = answerable.map((item) => {
    const rs = responses.filter((r) => r.itemId === item.id);
    const firsts = rs.filter((r) => r.firstAnswer !== null);
    const seconds = rs.filter((r) => r.secondAnswer !== null);
    return {
      label: labels.get(item.id) ?? "",
      talked: item.talked,
      firstRight: share(firsts.filter((r) => r.firstCorrect).length, firsts.length),
      secondRight: item.talked ? share(seconds.filter((r) => r.secondCorrect).length, seconds.length) : null,
    };
  });
  const byStudent = new Map<string, { right: number; answered: number; total: number }>();
  for (const slot of own) {
    const e = byStudent.get(slot.studentId) ?? { right: 0, answered: 0, total: 0 };
    e.total++;
    if (slot.isCorrect !== null) e.answered++;
    if (slot.isCorrect) e.right++;
    byStudent.set(slot.studentId, e);
  }
  const answeredStudents = [...byStudent.values()].filter((e) => e.answered > 0);
  const takeaways = [
    ...new Set(
      items
        .filter((i) => i.kind !== "WARMUP")
        .map((i) => infos.get(i.questionRevisionId)?.takeaway)
        .filter((t): t is string => !!t),
    ),
  ].slice(0, 3);
  return {
    questions,
    ownAverage: answeredStudents.length > 0 ? answeredStudents.reduce((a, e) => a + e.right, 0) / answeredStudents.length : null,
    ownTotal: Math.max(0, ...[...byStudent.values()].map((e) => e.total)),
    takeaways,
  };
}
