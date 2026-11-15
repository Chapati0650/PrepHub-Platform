import { randomBytes } from "node:crypto";
import type { ClubSection } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isAnswerCorrect } from "@/lib/adaptive/grading";
import { getStudentQuestionContent, type StudentQuestionContent } from "@/lib/session/question-content";
import type { TeacherContext } from "@/lib/teacher/access";
import { teacherName } from "@/lib/teacher/names";
import { RUSH_DIFFICULTY, RUSH_SCORING_VERSION, RUSH_SECTIONS, RUSH_TIME_LIMIT_MS, RUSH_GRACE_MS } from "./config";
import { createSet } from "./create";
import { scoreRushAnswerWithStreak, streakBefore } from "./scoring";
import {
  CLASS_RUSH_COUNTDOWN_MS,
  CLASS_RUSH_REVEAL_MS,
  CLASS_RUSH_SIZES,
  CLASS_RUSH_STALE_MS,
  classRushPhase,
  nextClassRushStep,
  placesFor,
  type ClassRushPhase,
} from "./class-rush-clock";

// Class Rush (2026-11-15, the Owner's request): one 1v1 Rush the whole class
// plays at once. The teacher opens it from a class, students join from their
// own screens, and everyone answers the same questions on one shared clock
// while the teacher's screen (on the projector) shows who's in, how many have
// answered, the right answer and the leaderboard.
//
// Built like a Guided Session for scale: every student screen polls one
// shared state, keyed by an unguessable key and cached at the edge for a
// second (app/api/class-rush/state), so thirty screens cost about one database
// read a second; a student's own score and question are fetched only when the
// game moves. The game advances whenever anyone looks (advanceClassRush is
// run by the shared-state route on each cache miss, the teacher's console and
// every answer), and every transition is claimed against `version`, so two
// lookers can't both advance it.
//
// Outside the adaptive engine and the predicted score like every Rush; the
// answers count as practice in school figures (lib/school/student-activity).

export class ClassRushError extends Error {
  constructor(
    public code: "NOT_FOUND" | "NOT_IN_CLASS" | "OVER" | "NOT_OPEN" | "INVALID",
    message: string,
  ) {
    super(message);
  }
}

const LEADERBOARD_SIZE = 10;

function isSize(n: number): boolean {
  return (CLASS_RUSH_SIZES as readonly number[]).includes(n);
}

/** "Maya R." — a first name and last initial, the way a classroom says it. A student hidden from leaderboards is "A classmate". */
function playerName(p: { firstName: string; lastName: string | null; hidden: boolean }): string {
  if (p.hidden) return "A classmate";
  const initial = p.lastName?.trim()?.[0];
  return initial ? `${p.firstName} ${initial.toUpperCase()}.` : p.firstName;
}

// ---- Teacher ------------------------------------------------------------------

/** Opens a game for a class, or returns the class's game already open. */
export async function createClassRush(
  context: TeacherContext,
  classroomId: string,
  params: { section: ClubSection; size: number },
): Promise<string> {
  if (!isSize(params.size) || !(params.section in RUSH_SECTIONS)) throw new ClassRushError("INVALID", "Choose a section and a length.");
  const open = await prisma.classRush.findFirst({
    where: { classroomId, teacherId: context.userId, status: { not: "FINISHED" }, createdAt: { gt: new Date(Date.now() - CLASS_RUSH_STALE_MS) } },
    select: { id: true },
  });
  if (open) return open.id;
  return prisma.$transaction(async (tx) => {
    const set = await createSet(context.userId, params.section, RUSH_DIFFICULTY, tx, params.size);
    const rush = await tx.classRush.create({
      data: {
        classroomId,
        teacherId: context.userId,
        setId: set.id,
        stateKey: randomBytes(18).toString("base64url"),
        scoringVersion: RUSH_SCORING_VERSION,
      },
      select: { id: true },
    });
    return rush.id;
  });
}

async function ownedRush(context: TeacherContext, rushId: string) {
  const rush = await prisma.classRush.findFirst({ where: { id: rushId, teacherId: context.userId }, select: { id: true } });
  if (!rush) throw new ClassRushError("NOT_FOUND", "That Class Rush isn't one of yours.");
}

/** The teacher's Start: everyone gets the same five-second countdown to question 1. */
export async function startClassRush(context: TeacherContext, rushId: string): Promise<boolean> {
  await ownedRush(context, rushId);
  const now = Date.now();
  const r = await prisma.classRush.updateMany({
    where: { id: rushId, status: "LOBBY", players: { some: {} } },
    data: {
      status: "PLAYING",
      position: 0,
      openedAt: new Date(now + CLASS_RUSH_COUNTDOWN_MS),
      closedAt: null,
      startedAt: new Date(now),
      version: { increment: 1 },
    },
  });
  return r.count === 1;
}

/** Closes the open question now (the teacher's "Show the answer"). */
export async function closeClassRushQuestion(context: TeacherContext, rushId: string): Promise<void> {
  await ownedRush(context, rushId);
  await prisma.classRush.updateMany({
    where: { id: rushId, status: "PLAYING", closedAt: null, openedAt: { lte: new Date() } },
    data: { closedAt: new Date(), version: { increment: 1 } },
  });
}

/** Ends the game where it stands; scores so far are final. */
export async function endClassRush(context: TeacherContext, rushId: string): Promise<void> {
  await ownedRush(context, rushId);
  await prisma.classRush.updateMany({
    where: { id: rushId, status: { not: "FINISHED" } },
    data: { status: "FINISHED", endedAt: new Date(), version: { increment: 1 } },
  });
}

// ---- The clock ------------------------------------------------------------------

/** Moves the game on if it's due. Safe to call from anywhere, any number of times. */
export async function advanceClassRush(rushId: string, now: number = Date.now()): Promise<void> {
  const r = await prisma.classRush.findUnique({
    where: { id: rushId },
    select: {
      status: true,
      position: true,
      openedAt: true,
      closedAt: true,
      version: true,
      createdAt: true,
      set: { select: { section: true, _count: { select: { slots: true } } } },
      _count: { select: { players: true } },
    },
  });
  if (!r) return;
  // A game left open for hours (a teacher who closed the tab) is over.
  if (r.status !== "FINISHED" && now - r.createdAt.getTime() > CLASS_RUSH_STALE_MS) {
    await prisma.classRush.updateMany({ where: { id: rushId, version: r.version }, data: { status: "FINISHED", endedAt: new Date(now), version: { increment: 1 } } });
    return;
  }
  if (r.status !== "PLAYING") return;
  const answered = await prisma.classRushAnswer.count({ where: { player: { rushId }, position: r.position } });
  const step = nextClassRushStep(
    {
      status: r.status,
      position: r.position,
      total: r.set._count.slots,
      openedAt: r.openedAt,
      closedAt: r.closedAt,
      players: r._count.players,
      answered,
      limitMs: RUSH_TIME_LIMIT_MS[r.set.section],
    },
    now,
  );
  if (step === "NONE") return;
  const data =
    step === "CLOSE"
      ? { closedAt: new Date(now) }
      : step === "NEXT"
        ? { position: r.position + 1, openedAt: new Date(now), closedAt: null }
        : { status: "FINISHED" as const, endedAt: new Date(now) };
  await prisma.classRush.updateMany({ where: { id: rushId, version: r.version }, data: { ...data, version: { increment: 1 } } });
}

// ---- What everyone sees ------------------------------------------------------------

export type ClassRushLeader = { name: string; score: number; place: number };

/**
 * The shared state: what the projector and every student screen draw. Nothing
 * here is one student's answer, so it is safe to cache and to show the room.
 * Times are absolute (epoch ms) with the server's clock, so each screen counts
 * down on its own.
 */
export type ClassRushShared = {
  v: number;
  status: "LOBBY" | "PLAYING" | "FINISHED";
  phase: ClassRushPhase;
  position: number;
  total: number;
  section: ClubSection;
  sectionLabel: string;
  limitMs: number;
  openedAt: number | null;
  closedAt: number | null;
  revealMs: number;
  serverNow: number;
  players: number;
  answered: number;
  className: string;
  teacherName: string;
  /** Shown at each reveal and at the end; null while a question is open, so nobody watches scores instead of the question. */
  leaders: ClassRushLeader[] | null;
};

async function loadShared(where: { id: string } | { stateKey: string }, now: number) {
  const r = await prisma.classRush.findUnique({
    where: "id" in where ? { id: where.id } : { stateKey: where.stateKey },
    select: {
      id: true,
      status: true,
      position: true,
      openedAt: true,
      closedAt: true,
      version: true,
      classroomId: true,
      classroom: { select: { name: true, teacher: { select: { firstName: true, teacherDisplayName: true } } } },
      set: { select: { section: true, _count: { select: { slots: true } } } },
      players: {
        orderBy: [{ score: "desc" }, { totalMs: "asc" }, { joinedAt: "asc" }],
        select: {
          id: true,
          studentId: true,
          score: true,
          correctCount: true,
          student: { select: { firstName: true, rushLeaderboardHidden: true } },
        },
      },
    },
  });
  if (!r) return null;
  const answered = r.status === "PLAYING" ? await prisma.classRushAnswer.count({ where: { player: { rushId: r.id }, position: r.position } }) : 0;
  const enrollments = await prisma.classroomEnrollment.findMany({
    where: { classroomId: r.classroomId, studentId: { in: r.players.map((p) => p.studentId) } },
    select: { studentId: true, lastName: true },
  });
  const lastNames = new Map(enrollments.map((e) => [e.studentId, e.lastName]));
  const named = r.players.map((p) => ({
    ...p,
    name: playerName({ firstName: p.student.firstName, lastName: lastNames.get(p.studentId) ?? null, hidden: p.student.rushLeaderboardHidden }),
  }));
  const phase = classRushPhase(r, now);
  const places = placesFor(named.map((p) => p.score));
  const shared: ClassRushShared = {
    v: r.version,
    status: r.status,
    phase,
    position: r.position,
    total: r.set._count.slots,
    section: r.set.section,
    sectionLabel: RUSH_SECTIONS[r.set.section].label,
    limitMs: RUSH_TIME_LIMIT_MS[r.set.section],
    openedAt: r.openedAt?.getTime() ?? null,
    closedAt: r.closedAt?.getTime() ?? null,
    revealMs: CLASS_RUSH_REVEAL_MS,
    serverNow: now,
    players: named.length,
    answered,
    className: r.classroom.name,
    teacherName: teacherName(r.classroom.teacher),
    leaders:
      phase === "REVEAL" || phase === "FINISHED"
        ? named.slice(0, LEADERBOARD_SIZE).map((p, i) => ({ name: p.name, score: p.score, place: places[i] }))
        : null,
  };
  return { shared, rush: r, players: named, places };
}

/** For the cached route: advance, then describe. */
export async function getClassRushShared(stateKey: string): Promise<ClassRushShared | null> {
  const found = await prisma.classRush.findUnique({ where: { stateKey }, select: { id: true } });
  if (!found) return null;
  await advanceClassRush(found.id);
  const loaded = await loadShared({ id: found.id }, Date.now());
  return loaded?.shared ?? null;
}

export type ClassRushConsole = ClassRushShared & {
  stateKey: string;
  classroomId: string;
  /** Everyone in the game, best first, with whether they've answered the open question. */
  roster: { name: string; score: number; place: number; answered: boolean }[];
  /** The question on screen: its stem for the projector, and once it closes, the answer and how many got it. */
  question: { text: string; answerLabel: string | null; correct: number | null } | null;
};

/** The teacher's screen: everything the room sees, plus who's in and the answer. */
export async function getClassRushConsole(context: TeacherContext, rushId: string): Promise<ClassRushConsole> {
  await ownedRush(context, rushId);
  await advanceClassRush(rushId);
  const now = Date.now();
  const loaded = await loadShared({ id: rushId }, now);
  if (!loaded) throw new ClassRushError("NOT_FOUND", "That Class Rush is gone.");
  const { shared, players, places } = loaded;
  const stateKey = (await prisma.classRush.findUniqueOrThrow({ where: { id: rushId }, select: { stateKey: true } })).stateKey;
  const current =
    shared.status === "PLAYING"
      ? await prisma.classRushAnswer.findMany({ where: { player: { rushId }, position: shared.position }, select: { playerId: true, isCorrect: true } })
      : [];
  const answeredBy = new Set(current.map((a) => a.playerId));

  let question: ClassRushConsole["question"] = null;
  if (shared.status === "PLAYING" && shared.phase !== "COUNTDOWN") {
    const slot = await prisma.rushSlot.findFirst({
      where: { set: { classRushes: { some: { id: rushId } } }, position: shared.position },
      select: { questionRevision: { select: { questionText: true, acceptedAnswers: true, answerChoices: { orderBy: { order: "asc" }, select: { isCorrect: true } } } } },
    });
    if (slot) {
      const rev = slot.questionRevision;
      const correctIndex = rev.answerChoices.findIndex((c) => c.isCorrect);
      const revealed = shared.phase === "REVEAL";
      question = {
        text: rev.questionText,
        answerLabel: revealed ? (correctIndex >= 0 ? String.fromCharCode(65 + correctIndex) : (rev.acceptedAnswers[0] ?? null)) : null,
        correct: revealed ? current.filter((a) => a.isCorrect).length : null,
      };
    }
  }
  return {
    ...shared,
    stateKey,
    classroomId: loaded.rush.classroomId,
    roster: players.map((p, i) => ({ name: p.name, score: p.score, place: places[i], answered: answeredBy.has(p.id) })),
    question,
  };
}

// ---- Students ------------------------------------------------------------------

async function studentInClass(studentId: string, rushId: string) {
  const r = await prisma.classRush.findUnique({
    where: { id: rushId },
    select: { id: true, status: true, classroomId: true, stateKey: true, classroom: { select: { archivedAt: true } } },
  });
  if (!r) throw new ClassRushError("NOT_FOUND", "That Class Rush is gone.");
  const enrolled = await prisma.classroomEnrollment.findFirst({ where: { classroomId: r.classroomId, studentId, removedAt: null }, select: { id: true } });
  if (!enrolled || r.classroom.archivedAt) throw new ClassRushError("NOT_IN_CLASS", "This Class Rush is for another class.");
  return r;
}

/** Joining is a button press, open until the game ends (a late student starts at the question the class is on). */
export async function joinClassRush(studentId: string, rushId: string): Promise<void> {
  const r = await studentInClass(studentId, rushId);
  if (r.status === "FINISHED") throw new ClassRushError("OVER", "This Class Rush has ended.");
  await prisma.classRushPlayer.upsert({ where: { rushId_studentId: { rushId, studentId } }, create: { rushId, studentId }, update: {} });
}

/** The page's view of a student: in the class, in the game, and the key to the shared state. */
export async function classRushForStudent(studentId: string, rushId: string) {
  const r = await studentInClass(studentId, rushId);
  const player = await prisma.classRushPlayer.findUnique({ where: { rushId_studentId: { rushId, studentId } }, select: { id: true } });
  return { stateKey: r.stateKey, joined: player !== null, status: r.status };
}

export type ClassRushMe = {
  score: number;
  correct: number;
  place: number;
  players: number;
  /** This student's answer to the question the class is on, if they've given one. */
  answer: { position: number; isCorrect: boolean; points: number; streak: number } | null;
};

export async function classRushMe(studentId: string, rushId: string): Promise<ClassRushMe> {
  const loaded = await loadShared({ id: rushId }, Date.now());
  if (!loaded) throw new ClassRushError("NOT_FOUND", "That Class Rush is gone.");
  const i = loaded.players.findIndex((p) => p.studentId === studentId);
  if (i < 0) throw new ClassRushError("NOT_IN_CLASS", "Join the Class Rush first.");
  const me = loaded.players[i];
  const answers = await prisma.classRushAnswer.findMany({ where: { playerId: me.id }, select: { position: true, points: true, isCorrect: true } });
  const current = answers.find((a) => a.position === loaded.shared.position);
  return {
    score: me.score,
    correct: me.correctCount,
    place: loaded.places[i],
    players: loaded.players.length,
    answer: current
      ? { position: current.position, isCorrect: current.isCorrect, points: current.points, streak: current.points > 0 ? streakBefore(answers, current.position) + 1 : 0 }
      : null,
  };
}

export type ClassRushQuestion = {
  position: number;
  content: StudentQuestionContent;
  /** Only once the question has closed: the right choice (or the accepted answer), for the reveal. */
  correctChoiceId: string | null;
  acceptedAnswer: string | null;
};

/** The question the class is on, once it has opened. The answer comes with it only after it closes. */
export async function serveClassRushQuestion(studentId: string, rushId: string): Promise<ClassRushQuestion> {
  await studentInClass(studentId, rushId);
  const r = await prisma.classRush.findUniqueOrThrow({ where: { id: rushId }, select: { status: true, position: true, openedAt: true, closedAt: true, setId: true } });
  if (r.status !== "PLAYING" || !r.openedAt || r.openedAt.getTime() > Date.now()) throw new ClassRushError("NOT_OPEN", "The next question hasn't opened yet.");
  const slot = await prisma.rushSlot.findUnique({
    where: { setId_position: { setId: r.setId, position: r.position } },
    select: { questionRevisionId: true, questionRevision: { select: { acceptedAnswers: true, answerChoices: { select: { id: true, isCorrect: true } } } } },
  });
  if (!slot) throw new ClassRushError("NOT_FOUND", "Question not found.");
  const closed = r.closedAt !== null;
  return {
    position: r.position,
    content: await getStudentQuestionContent(slot.questionRevisionId),
    correctChoiceId: closed ? (slot.questionRevision.answerChoices.find((c) => c.isCorrect)?.id ?? null) : null,
    acceptedAnswer: closed ? (slot.questionRevision.acceptedAnswers[0] ?? null) : null,
  };
}

export type ClassRushAnswerResult = { isCorrect: boolean; points: number; streak: number; score: number };

/**
 * One answer, timed by the server from the moment the question opened for
 * everyone, scored by the same rules as every Rush. Recorded once: a repeat
 * returns the first. Answering may be what closes the question.
 */
export async function submitClassRushAnswer(params: { studentId: string; rushId: string; position: number; answer: string | null }): Promise<ClassRushAnswerResult> {
  const { studentId, rushId, position, answer } = params;
  const result = await prisma.$transaction(async (tx) => {
    const r = await tx.classRush.findUnique({
      where: { id: rushId },
      select: { status: true, position: true, openedAt: true, closedAt: true, scoringVersion: true, setId: true, set: { select: { section: true } } },
    });
    const player = await tx.classRushPlayer.findUnique({ where: { rushId_studentId: { rushId, studentId } }, include: { answers: true } });
    if (!r || !player) throw new ClassRushError("NOT_FOUND", "Join the Class Rush first.");
    const existing = player.answers.find((a) => a.position === position);
    if (existing) {
      return { isCorrect: existing.isCorrect, points: existing.points, streak: existing.points > 0 ? streakBefore(player.answers, position) + 1 : 0, score: player.score };
    }
    const now = Date.now();
    const limitMs = RUSH_TIME_LIMIT_MS[r.set.section];
    if (r.status !== "PLAYING" || r.position !== position || !r.openedAt || r.closedAt || r.openedAt.getTime() > now) {
      throw new ClassRushError("OVER", "That question is over.");
    }
    const elapsedMs = now - r.openedAt.getTime();
    if (elapsedMs > limitMs + RUSH_GRACE_MS) throw new ClassRushError("OVER", "That question is over.");
    const slot = await tx.rushSlot.findUniqueOrThrow({
      where: { setId_position: { setId: r.setId, position } },
      include: { question: true, questionRevision: { include: { answerChoices: true } } },
    });
    const isCorrect = answer !== null && answer !== "" && isAnswerCorrect(slot.question.questionType, answer, slot.questionRevision);
    const scored = scoreRushAnswerWithStreak({
      isCorrect,
      elapsedMs: Math.min(elapsedMs, limitMs),
      limitMs,
      previousStreak: streakBefore(player.answers, position),
      version: r.scoringVersion,
    });
    await tx.classRushAnswer.create({
      data: { playerId: player.id, studentId, position, answer, isCorrect, points: scored.points, elapsedMs: Math.min(elapsedMs, limitMs) },
    });
    const updated = await tx.classRushPlayer.update({
      where: { id: player.id },
      data: { score: { increment: scored.points }, correctCount: { increment: isCorrect ? 1 : 0 }, totalMs: { increment: Math.min(elapsedMs, limitMs) } },
      select: { score: true },
    });
    return { isCorrect, points: scored.points, streak: scored.streak, score: updated.score };
  });
  // The last answer in closes the question for everyone.
  await advanceClassRush(rushId);
  return result;
}

/** The class games a student could join right now, for the banners on their Rush, home and Homework pages. */
export async function openClassRushesFor(studentId: string): Promise<{ id: string; className: string; teacherName: string; started: boolean }[]> {
  const rows = await prisma.classRush.findMany({
    where: {
      status: { not: "FINISHED" },
      createdAt: { gt: new Date(Date.now() - CLASS_RUSH_STALE_MS) },
      classroom: { archivedAt: null, enrollments: { some: { studentId, removedAt: null } } },
    },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, status: true, classroom: { select: { name: true, teacher: { select: { firstName: true, teacherDisplayName: true } } } } },
  });
  return rows.map((r) => ({ id: r.id, className: r.classroom.name, teacherName: teacherName(r.classroom.teacher), started: r.status === "PLAYING" }));
}
