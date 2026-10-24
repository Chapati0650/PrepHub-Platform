import type { ClubSection, RushMode } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isAnswerCorrect } from "@/lib/adaptive/grading";
import { getStudentQuestionContent, type StudentQuestionContent } from "@/lib/session/question-content";
import { LIVE_PRESENCE_MS, RUSH_DIFFICULTY, RUSH_SECTIONS, RUSH_TIME_LIMIT_MS } from "./config";
import {
  compareRuns,
  isOverLimit,
  maxRushScore,
  scoreRushAnswerWithStreak,
  streakBefore,
  type RushOutcome,
} from "./scoring";
import { RushError } from "./errors";
import { joinLiveRoom } from "./live";
import { createChallenge, createSet } from "./create";

// Everything here is independent of src/lib/adaptive, exactly like the 800
// Club: a rush never reads or writes CategoryState, PracticeSet,
// FinalizedAttempt or PredictionHistoryEntry. It borrows the seeded PRNG
// and the answer grader and nothing that carries state.

// Solo and friend: a new set, a new challenge, and the creator's run — all
// in one transaction so a half-made challenge can't exist.
export async function startRush(
  studentId: string,
  params: { section: ClubSection; mode: "SOLO" | "FRIEND" },
): Promise<{ runId: string; challengeId: string; code: string }> {
  return prisma.$transaction(async (tx) => {
    const set = await createSet(studentId, params.section, RUSH_DIFFICULTY, tx);
    const challenge = await createChallenge(tx, { setId: set.id, mode: params.mode, creatorId: studentId });
    const run = await tx.rushRun.create({ data: { challengeId: challenge.id, studentId }, select: { id: true } });
    return { runId: run.id, challengeId: challenge.id, code: challenge.code };
  });
}

// Random matching against a *recorded* run — the fallback when nobody is
// online for a live room (see live.ts). Join the oldest async RANDOM
// challenge in this section whose creator has already finished and that
// nobody else has joined; if there is none, open one and become the person
// the next student gets matched with. The creator-finished rule is what
// keeps an abandoned run from ever becoming somebody's opponent.
//
// Two students joining the same waiting challenge in the same instant could
// both pass the "one run" check and produce a three-run RANDOM challenge.
// That's a benign outcome (the results page ranks everyone in it) and at
// this product's scale not worth a row lock.
export async function startRandomRush(studentId: string, params: { section: ClubSection }): Promise<{ runId: string; challengeId: string; matched: boolean }> {
  return prisma.$transaction(async (tx) => {
    // "Exactly one run" can't be expressed in a where clause, so fetch the
    // oldest few candidates and take the first that still has only its
    // creator in it.
    const candidates = await tx.rushChallenge.findMany({
      where: {
        mode: "RANDOM",
        live: false,
        creatorId: { not: studentId },
        set: { section: params.section },
        runs: { every: { status: "COMPLETED" }, none: { studentId } },
      },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { id: true, _count: { select: { runs: true } } },
    });
    const waiting = candidates.find((c) => c._count.runs === 1);
    if (waiting) {
      const run = await tx.rushRun.create({ data: { challengeId: waiting.id, studentId }, select: { id: true } });
      return { runId: run.id, challengeId: waiting.id, matched: true };
    }
    const set = await createSet(studentId, params.section, RUSH_DIFFICULTY, tx);
    const challenge = await createChallenge(tx, { setId: set.id, mode: "RANDOM", creatorId: studentId });
    const run = await tx.rushRun.create({ data: { challengeId: challenge.id, studentId }, select: { id: true } });
    return { runId: run.id, challengeId: challenge.id, matched: false };
  });
}

// ---- Joining by code / link -----------------------------------------------

export type ChallengePreview = {
  challengeId: string;
  code: string;
  mode: RushMode;
  section: ClubSection;
  sectionLabel: string;
  questionCount: number;
  limitMs: number;
  creatorName: string;
  creatorFinished: boolean;
  participants: number;
  // The viewer's own standing in it, so the join page can route them on.
  myRun: { id: string; status: "ACTIVE" | "COMPLETED" } | null;
  isCreator: boolean;
  // Live rooms: joinable only while WAITING with the creator still polling.
  live: boolean;
  liveStatus: "WAITING" | "COUNTDOWN" | "PLAYING" | "FINISHED" | null;
  creatorPresent: boolean;
};

export async function getChallengePreview(studentId: string, code: string): Promise<ChallengePreview | null> {
  const c = await prisma.rushChallenge.findUnique({
    where: { code },
    include: {
      set: { select: { section: true, difficulty: true, _count: { select: { slots: true } } } },
      creator: { select: { firstName: true } },
      runs: { select: { id: true, studentId: true, status: true, lastSeenAt: true } },
    },
  });
  if (!c) return null;
  const mine = c.runs.find((r) => r.studentId === studentId) ?? null;
  const creatorRun = c.runs.find((r) => r.studentId === c.creatorId);
  return {
    challengeId: c.id,
    code: c.code,
    mode: c.mode,
    section: c.set.section,
    sectionLabel: RUSH_SECTIONS[c.set.section].label,
    questionCount: c.set._count.slots,
    limitMs: RUSH_TIME_LIMIT_MS[c.set.section],
    creatorName: c.creator.firstName,
    creatorFinished: creatorRun?.status === "COMPLETED",
    participants: c.runs.length,
    myRun: mine ? { id: mine.id, status: mine.status } : null,
    isCreator: c.creatorId === studentId,
    live: c.live,
    liveStatus: c.liveStatus,
    creatorPresent: Boolean(creatorRun && Date.now() - creatorRun.lastSeenAt.getTime() < LIVE_PRESENCE_MS),
  };
}

// Accepting a friend's challenge — the free hook. Only FRIEND challenges are
// joinable by code: a SOLO run is one person's, and a RANDOM pairing is made
// by startRandomRush, not by handing out its code. Idempotent: a student who
// already has a run in the challenge gets that run back.
export async function joinChallenge(studentId: string, code: string): Promise<{ runId: string; challengeId: string; live: boolean }> {
  const c = await prisma.rushChallenge.findUnique({
    where: { code },
    select: { id: true, mode: true, live: true, invitedStudentId: true, runs: { where: { studentId }, select: { id: true } } },
  });
  if (!c) throw new RushError("CHALLENGE_NOT_FOUND", "No challenge has that code. Check it and try again.");
  if (c.runs[0]) return { runId: c.runs[0].id, challengeId: c.id, live: c.live };
  if (c.mode !== "FRIEND") throw new RushError("NOT_JOINABLE", "That rush isn't open to join.");
  if (c.invitedStudentId && c.invitedStudentId !== studentId) {
    throw new RushError("NOT_JOINABLE", "That rematch is for someone else.");
  }
  if (c.live) {
    const joined = await joinLiveRoom(studentId, c.id);
    return { runId: joined.runId, challengeId: c.id, live: true };
  }
  const run = await prisma.rushRun.create({ data: { challengeId: c.id, studentId }, select: { id: true } });
  return { runId: run.id, challengeId: c.id, live: false };
}

// ---- Playing ----------------------------------------------------------------

export type ServedQuestion = {
  runId: string;
  position: number;
  total: number;
  limitMs: number;
  // Time left as of this response — the client counts down from its own
  // clock, so a skewed device clock can't shorten or extend the question.
  remainingMs: number;
  content: StudentQuestionContent;
  // Ghost of an opponent who already played this question, when there is
  // one. Only ever shown to the second player; the first has nobody to race.
  ghost: { name: string; elapsedMs: number; isCorrect: boolean } | null;
};

export type RunContext = {
  id: string;
  status: "ACTIVE" | "COMPLETED";
  challengeId: string;
  mode: RushMode;
  section: ClubSection;
  sectionLabel: string;
  score: number;
  position: number;
  total: number;
  limitMs: number;
  // First name of a finished opponent whose times will ghost this run.
  opponentName: string | null;
  // A live room's run is played at /rush/live/[challengeId], never here.
  live: boolean;
  /** The points rules this run is scored by; streak UI shows only from 2. */
  scoringVersion: number;
  /** Correct answers in a row so far, so a resumed run shows the right flame. */
  streak: number;
};

export async function getRunContext(studentId: string, runId: string): Promise<RunContext | null> {
  const run = await prisma.rushRun.findUnique({
    where: { id: runId },
    include: {
      challenge: {
        include: {
          set: { select: { section: true, difficulty: true, _count: { select: { slots: true } } } },
          runs: { where: { studentId: { not: studentId }, status: "COMPLETED" }, orderBy: { completedAt: "asc" }, take: 1, select: { student: { select: { firstName: true } } } },
        },
      },
      answers: { select: { position: true, points: true } },
    },
  });
  if (!run || run.studentId !== studentId) return null;
  return {
    id: run.id,
    status: run.status,
    challengeId: run.challengeId,
    mode: run.challenge.mode,
    section: run.challenge.set.section,
    sectionLabel: RUSH_SECTIONS[run.challenge.set.section].label,
    score: run.score,
    position: run.position,
    total: run.challenge.set._count.slots,
    limitMs: RUSH_TIME_LIMIT_MS[run.challenge.set.section],
    opponentName: run.challenge.runs[0]?.student.firstName ?? null,
    live: run.challenge.live,
    scoringVersion: run.challenge.scoringVersion,
    streak: streakBefore(run.answers, run.position),
  };
}

// Serves the run's current question and starts its clock. The clock starts
// when the RushAnswer row is created (servedAt), and an existing row is
// reused — so reloading the page mid-question resumes the same countdown
// instead of restarting it. Returns null when the run is complete.
export async function serveCurrentQuestion(studentId: string, runId: string): Promise<ServedQuestion | null> {
  const run = await prisma.rushRun.findUnique({
    where: { id: runId },
    include: {
      challenge: { include: { set: { include: { slots: { orderBy: { position: "asc" } } } } } },
    },
  });
  if (!run || run.studentId !== studentId) throw new RushError("RUN_NOT_FOUND", "Rush not found.");
  if (run.challenge.live) throw new RushError("RUN_NOT_FOUND", "This is a live rush. Open its room instead.");
  if (run.status === "COMPLETED") return null;
  const slots = run.challenge.set.slots;
  const slot = slots[run.position];
  if (!slot) {
    // Every slot answered but the run wasn't closed (a crash between the
    // last answer and the completion update). Close it now.
    await finishRun(runId);
    return null;
  }

  const limitMs = RUSH_TIME_LIMIT_MS[run.challenge.set.section];
  const served = await prisma.rushAnswer.upsert({
    where: { runId_position: { runId, position: run.position } },
    create: { runId, position: run.position },
    update: {},
    select: { servedAt: true, answeredAt: true },
  });
  // An answered row at the current position means the answer landed but the
  // position bump didn't — same recovery as above, advance and re-serve.
  if (served.answeredAt) {
    await prisma.rushRun.update({ where: { id: runId }, data: { position: run.position + 1 } });
    return serveCurrentQuestion(studentId, runId);
  }

  const [content, ghost] = await Promise.all([
    getStudentQuestionContent(slot.questionRevisionId),
    prisma.rushAnswer.findFirst({
      where: { run: { challengeId: run.challengeId, studentId: { not: studentId }, status: "COMPLETED" }, position: run.position },
      orderBy: { run: { completedAt: "asc" } },
      select: { elapsedMs: true, isCorrect: true, run: { select: { student: { select: { firstName: true } } } } },
    }),
  ]);

  return {
    runId,
    position: run.position,
    total: slots.length,
    limitMs,
    remainingMs: Math.max(0, limitMs - (Date.now() - served.servedAt.getTime())),
    content,
    ghost: ghost && ghost.elapsedMs !== null ? { name: ghost.run.student.firstName, elapsedMs: ghost.elapsedMs, isCorrect: ghost.isCorrect ?? false } : null,
  };
}

export type RushAnswerResult = {
  isCorrect: boolean;
  points: number;
  /** Where the points came from, for the runner's breakdown. */
  base: number;
  speed: number;
  streakBonus: number;
  /** Correct answers in a row after this one (0 if this one missed). */
  streak: number;
  elapsedMs: number;
  // The clock ran out: the client auto-submitted blank (timedOut), or a
  // real answer arrived past the grace window (overLimit). Both score 0.
  timedOut: boolean;
  overLimit: boolean;
  score: number;
  correctChoiceId: string | null;
  acceptedAnswer: string | null;
  done: boolean;
};

// Grades and scores one answer. `answer` null = the client's clock ran out.
// Elapsed time is servedAt → now, on the server. Idempotent: a retried
// submit for an already-answered position returns what was recorded, and
// the run's totals are only ever bumped once per position because the
// answeredAt check and the writes share a transaction.
export async function submitRushAnswer(params: { studentId: string; runId: string; position: number; answer: string | null }): Promise<RushAnswerResult> {
  const { studentId, runId, position, answer } = params;
  return prisma.$transaction(async (tx) => {
    const run = await tx.rushRun.findUnique({
      where: { id: runId },
      include: {
        challenge: { include: { set: { include: { slots: { where: { position }, include: { question: true, questionRevision: { include: { answerChoices: true } } } } } } } },
        // Every answer, not just this position's: the streak is read from
        // the ones before it. Ten rows at most.
        answers: true,
      },
    });
    if (!run || run.studentId !== studentId) throw new RushError("RUN_NOT_FOUND", "Rush not found.");
    if (run.challenge.live) throw new RushError("RUN_NOT_FOUND", "This is a live rush. Open its room instead.");
    const slot = run.challenge.set.slots[0];
    if (!slot) throw new RushError("RUN_NOT_FOUND", "Question not found.");
    const total = await tx.rushSlot.count({ where: { setId: run.challenge.setId } });
    const revision = slot.questionRevision;
    const correctChoiceId = revision.answerChoices.find((c) => c.isCorrect)?.id ?? null;
    const acceptedAnswer = revision.acceptedAnswers[0] ?? null;

    const existing = run.answers.find((a) => a.position === position);
    if (existing?.answeredAt) {
      // A retried submit: report what was recorded. The streak is recomputed
      // from the stored rows, which is exactly what it was the first time.
      const replayStreak = (existing.points ?? 0) > 0 ? streakBefore(run.answers, position) + 1 : 0;
      return {
        isCorrect: existing.isCorrect ?? false,
        points: existing.points ?? 0,
        base: 0,
        speed: 0,
        streakBonus: 0,
        streak: replayStreak,
        elapsedMs: existing.elapsedMs ?? 0,
        timedOut: existing.answer === null,
        overLimit: existing.elapsedMs !== null && isOverLimit(existing.elapsedMs, RUSH_TIME_LIMIT_MS[run.challenge.set.section]),
        score: run.score,
        correctChoiceId,
        acceptedAnswer,
        done: run.status === "COMPLETED",
      };
    }
    if (run.status === "COMPLETED") throw new RushError("RUN_COMPLETED", "This rush is already finished.");
    if (!existing) throw new RushError("NOT_SERVED", "That question hasn't been served yet.");

    const limitMs = RUSH_TIME_LIMIT_MS[run.challenge.set.section];
    const now = new Date();
    const elapsedMs = Math.max(0, now.getTime() - existing.servedAt.getTime());
    const isCorrect = answer !== null && answer !== "" && isAnswerCorrect(slot.question.questionType, answer, revision);
    const scored = scoreRushAnswerWithStreak({
      isCorrect,
      elapsedMs,
      limitMs,
      previousStreak: streakBefore(run.answers, position),
      version: run.challenge.scoringVersion,
    });
    const points = scored.points;
    // A timeout still counts the full limit toward total time — the tie-break
    // shouldn't reward leaving the tab and coming back.
    const countedMs = Math.min(elapsedMs, limitMs);
    const done = position + 1 >= total;

    await tx.rushAnswer.update({
      where: { id: existing.id },
      data: { answeredAt: now, answer, isCorrect, elapsedMs, points },
    });
    const updated = await tx.rushRun.update({
      where: { id: runId },
      data: {
        position: Math.max(run.position, position + 1),
        score: { increment: points },
        correctCount: { increment: isCorrect ? 1 : 0 },
        totalMs: { increment: countedMs },
        ...(done ? { status: "COMPLETED", completedAt: now } : {}),
      },
      select: { score: true },
    });

    return {
      isCorrect,
      points,
      base: scored.base,
      speed: scored.speed,
      streakBonus: scored.streakBonus,
      streak: scored.streak,
      elapsedMs,
      timedOut: answer === null,
      overLimit: isOverLimit(elapsedMs, limitMs),
      score: updated.score,
      correctChoiceId,
      acceptedAnswer,
      done,
    };
  });
}

async function finishRun(runId: string) {
  await prisma.rushRun.updateMany({ where: { id: runId, status: "ACTIVE" }, data: { status: "COMPLETED", completedAt: new Date() } });
}

// ---- Results ----------------------------------------------------------------

export type RushParticipant = {
  runId: string;
  name: string;
  isMe: boolean;
  status: "ACTIVE" | "COMPLETED";
  score: number;
  correctCount: number;
  totalMs: number;
  /** The longest run of correct, in-time answers. */
  bestStreak: number;
  /** The quickest correct answer, or null if none was correct. */
  fastestCorrectMs: number | null;
  answers: { position: number; isCorrect: boolean | null; points: number | null; elapsedMs: number | null; answered: boolean }[];
};

export type RushResults = {
  challengeId: string;
  code: string;
  mode: RushMode;
  section: ClubSection;
  sectionLabel: string;
  live: boolean;
  limitMs: number;
  total: number;
  isCreator: boolean;
  me: RushParticipant;
  // Everyone else who has a run, finished first. RANDOM has at most one;
  // FRIEND can have several if a code was shared around.
  others: RushParticipant[];
  // Against the best finished opponent; null while solo or still waiting.
  outcome: RushOutcome | null;
  questions: { position: number; category: string; difficulty: string }[];
  /** The rules every run here was scored by, and the most a run could get. */
  scoringVersion: number;
  maxScore: number;
  /** Set on a rematch: the student it was sent to. */
  rematchFor: string | null;
};

export async function getRushResults(studentId: string, challengeId: string): Promise<RushResults | null> {
  const c = await prisma.rushChallenge.findUnique({
    where: { id: challengeId },
    include: {
      set: { include: { slots: { orderBy: { position: "asc" }, include: { question: { select: { category: true, difficulty: true } } } } } },
      invitedStudent: { select: { firstName: true } },
      runs: {
        include: { student: { select: { firstName: true } }, answers: { orderBy: { position: "asc" } } },
        orderBy: [{ score: "desc" }, { totalMs: "asc" }],
      },
    },
  });
  if (!c) return null;
  const mine = c.runs.find((r) => r.studentId === studentId);
  if (!mine || mine.status !== "COMPLETED") return null;

  const toParticipant = (r: (typeof c.runs)[number]): RushParticipant => ({
    runId: r.id,
    name: r.student.firstName,
    isMe: r.studentId === studentId,
    status: r.status,
    score: r.score,
    correctCount: r.correctCount,
    totalMs: r.totalMs,
    bestStreak: longestStreak(r.answers),
    fastestCorrectMs: fastestCorrect(r.answers),
    answers: c.set.slots.map((s) => {
      const a = r.answers.find((x) => x.position === s.position);
      return { position: s.position, isCorrect: a?.isCorrect ?? null, points: a?.points ?? null, elapsedMs: a?.elapsedMs ?? null, answered: Boolean(a?.answeredAt) };
    }),
  });

  const others = c.runs.filter((r) => r.studentId !== studentId).map(toParticipant);
  const finishedOthers = others.filter((o) => o.status === "COMPLETED");
  const best = finishedOthers[0] ?? null;

  return {
    challengeId: c.id,
    code: c.code,
    mode: c.mode,
    section: c.set.section,
    sectionLabel: RUSH_SECTIONS[c.set.section].label,
    live: c.live,
    limitMs: RUSH_TIME_LIMIT_MS[c.set.section],
    total: c.set.slots.length,
    isCreator: c.creatorId === studentId,
    me: toParticipant(mine),
    others,
    outcome: best ? compareRuns(mine, best) : null,
    questions: c.set.slots.map((s) => ({ position: s.position, category: s.question.category, difficulty: s.question.difficulty })),
    scoringVersion: c.scoringVersion,
    maxScore: maxRushScore(c.scoringVersion, c.set.slots.length),
    rematchFor: c.invitedStudent?.firstName ?? null,
  };
}

/** Longest run of answers that scored, in position order. */
function longestStreak(answers: { position: number; points: number | null }[]): number {
  let best = 0;
  let current = 0;
  for (const a of [...answers].sort((x, y) => x.position - y.position)) {
    current = (a.points ?? 0) > 0 ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

function fastestCorrect(answers: { points: number | null; elapsedMs: number | null }[]): number | null {
  const times = answers.filter((a) => (a.points ?? 0) > 0 && a.elapsedMs !== null).map((a) => a.elapsedMs!);
  return times.length > 0 ? Math.min(...times) : null;
}

// The revision for one position in a challenge the student has finished —
// for the results page's question review. A student who hasn't completed
// their run can't read the set through here, which is what keeps the
// second player from previewing the questions before they start.
export async function getReviewableSlot(studentId: string, challengeId: string, position: number) {
  const run = await prisma.rushRun.findUnique({
    where: { challengeId_studentId: { challengeId, studentId } },
    select: { status: true, answers: { where: { position }, select: { answer: true, isCorrect: true } } },
  });
  if (!run || run.status !== "COMPLETED") return null;
  const slot = await prisma.rushSlot.findFirst({ where: { set: { challenges: { some: { id: challengeId } } }, position }, select: { questionRevisionId: true } });
  if (!slot) return null;
  return { questionRevisionId: slot.questionRevisionId, answer: run.answers[0]?.answer ?? null, isCorrect: run.answers[0]?.isCorrect ?? false };
}

// ---- Hub ---------------------------------------------------------------------

export type RushHistoryRow = {
  challengeId: string;
  code: string;
  mode: RushMode;
  live: boolean;
  liveStatus: "WAITING" | "COUNTDOWN" | "PLAYING" | "FINISHED" | null;
  sectionLabel: string;
  createdAt: Date;
  myRunId: string;
  myStatus: "ACTIVE" | "COMPLETED";
  myScore: number;
  opponent: { name: string; score: number; finished: boolean } | null;
  outcome: RushOutcome | null;
  // FRIEND challenge I created that nobody has accepted yet — the hub shows
  // the code again so it can be re-sent.
  awaitingFriend: boolean;
  // RANDOM run I finished with no opponent yet.
  awaitingMatch: boolean;
  /** A rematch I sent: who it's for. Its code is never re-shown — it's already addressed. */
  rematchFor: string | null;
};

export type RushOverview = {
  pool: Record<ClubSection, number>;
  stats: { played: number; best: number | null; wins: number; losses: number; ties: number };
  history: RushHistoryRow[];
};

export async function getRushOverview(studentId: string): Promise<RushOverview> {
  const [poolCounts, runs] = await Promise.all([
    Promise.all(
      (["READING_WRITING", "MATH"] as const).map((section) =>
        prisma.question.count({
          where: { status: "PUBLISHED", category: { in: [...RUSH_SECTIONS[section].categories] }, currentPublishedRevisionId: { not: null } },
        }),
      ),
    ),
    prisma.rushRun.findMany({
      where: { studentId },
      orderBy: { startedAt: "desc" },
      take: 30,
      include: {
        challenge: {
          include: {
            set: { select: { section: true, difficulty: true } },
            invitedStudent: { select: { firstName: true } },
            runs: { where: { studentId: { not: studentId } }, include: { student: { select: { firstName: true } } }, orderBy: [{ score: "desc" }, { totalMs: "asc" }] },
          },
        },
      },
    }),
  ]);

  let wins = 0,
    losses = 0,
    ties = 0,
    best: number | null = null,
    played = 0;
  const history: RushHistoryRow[] = runs.map((r) => {
    const finished = r.status === "COMPLETED";
    if (finished) {
      played++;
      best = best === null ? r.score : Math.max(best, r.score);
    }
    const opp = r.challenge.runs.find((o) => o.status === "COMPLETED") ?? r.challenge.runs[0] ?? null;
    let outcome: RushOutcome | null = null;
    if (finished && opp && opp.status === "COMPLETED") {
      outcome = compareRuns(r, opp);
      if (outcome === "WON") wins++;
      else if (outcome === "LOST") losses++;
      else ties++;
    }
    const isCreator = r.challenge.creatorId === studentId;
    return {
      challengeId: r.challengeId,
      code: r.challenge.code,
      mode: r.challenge.mode,
      live: r.challenge.live,
      liveStatus: r.challenge.liveStatus,
      sectionLabel: RUSH_SECTIONS[r.challenge.set.section].label,
      createdAt: r.startedAt,
      myRunId: r.id,
      myStatus: r.status,
      myScore: r.score,
      opponent: opp ? { name: opp.student.firstName, score: opp.score, finished: opp.status === "COMPLETED" } : null,
      outcome,
      // A rematch waiting on its invitee isn't "waiting for a friend" in the
      // share-the-code sense: it's already addressed to one person.
      awaitingFriend:
        !r.challenge.live &&
        r.challenge.mode === "FRIEND" &&
        isCreator &&
        r.challenge.runs.length === 0 &&
        !r.challenge.invitedStudentId,
      awaitingMatch: !r.challenge.live && r.challenge.mode === "RANDOM" && finished && r.challenge.runs.length === 0,
      rematchFor: isCreator ? (r.challenge.invitedStudent?.firstName ?? null) : null,
    };
  });

  return {
    pool: { READING_WRITING: poolCounts[0], MATH: poolCounts[1] },
    stats: { played, best, wins, losses, ties },
    history,
  };
}
