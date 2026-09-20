import type { ClubSection, Prisma, RushDifficulty, RushMode } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createRandom, generateSeed } from "@/lib/adaptive/random";
import { isAnswerCorrect } from "@/lib/adaptive/grading";
import { getStudentQuestionContent, type StudentQuestionContent } from "@/lib/session/question-content";
import { RUSH_DIFFICULTIES, RUSH_RUN_SIZE, RUSH_SECTIONS, RUSH_TIME_LIMIT_MS } from "./config";
import { selectRushQuestions } from "./select-questions";
import { generateRushCode } from "./codes";
import { compareRuns, isOverLimit, scoreRushAnswer, type RushOutcome } from "./scoring";
import { RushError } from "./errors";

// Everything here is independent of src/lib/adaptive, exactly like the 800
// Club: a rush never reads or writes CategoryState, PracticeSet,
// FinalizedAttempt or PredictionHistoryEntry. It borrows the seeded PRNG
// and the answer grader and nothing that carries state.

// ---- Set + challenge creation ---------------------------------------------

async function createSet(studentId: string, section: ClubSection, difficulty: RushDifficulty, tx: Prisma.TransactionClient) {
  const [candidates, seen] = await Promise.all([
    tx.question.findMany({
      where: {
        status: "PUBLISHED",
        difficulty: { in: [...RUSH_DIFFICULTIES[difficulty].pool] },
        category: { in: [...RUSH_SECTIONS[section].categories] },
        currentPublishedRevisionId: { not: null },
      },
      select: { id: true, difficulty: true, currentPublishedRevisionId: true },
    }),
    // Every question in a set this student has a run in — seen or about to
    // be — so a new set avoids it while unseen questions remain.
    tx.rushSlot.findMany({
      where: { set: { challenges: { some: { runs: { some: { studentId } } } } } },
      select: { questionId: true },
      distinct: ["questionId"],
    }),
  ]);
  const seenIds = new Set(seen.map((s) => s.questionId));

  const randomSeed = generateSeed();
  const picked = selectRushQuestions({
    candidates: candidates.map((c) => ({ questionId: c.id, questionRevisionId: c.currentPublishedRevisionId!, difficulty: c.difficulty })),
    seenQuestionIds: seenIds,
    difficulty,
    size: RUSH_RUN_SIZE,
    random: createRandom(randomSeed),
  });
  if (picked.length === 0) throw new RushError("NO_QUESTIONS", "There aren't enough questions for that rush yet. Try another section or difficulty.");

  return tx.rushSet.create({
    data: {
      section,
      difficulty,
      randomSeed,
      slots: { create: picked.map((p, position) => ({ position, questionId: p.questionId, questionRevisionId: p.questionRevisionId })) },
    },
    select: { id: true },
  });
}

// A fresh code per challenge; the unique index catches the one-in-a-billion
// collision and we simply draw again.
async function createChallenge(
  tx: Prisma.TransactionClient,
  data: { setId: string; mode: RushMode; creatorId: string },
): Promise<{ id: string; code: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRushCode();
    try {
      return await tx.rushChallenge.create({ data: { ...data, code }, select: { id: true, code: true } });
    } catch (err) {
      if (attempt === 4 || !isUniqueViolation(err)) throw err;
    }
  }
  throw new Error("unreachable");
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
}

// Solo and friend: a new set, a new challenge, and the creator's run — all
// in one transaction so a half-made challenge can't exist.
export async function startRush(
  studentId: string,
  params: { section: ClubSection; difficulty: RushDifficulty; mode: "SOLO" | "FRIEND" },
): Promise<{ runId: string; challengeId: string; code: string }> {
  return prisma.$transaction(async (tx) => {
    const set = await createSet(studentId, params.section, params.difficulty, tx);
    const challenge = await createChallenge(tx, { setId: set.id, mode: params.mode, creatorId: studentId });
    const run = await tx.rushRun.create({ data: { challengeId: challenge.id, studentId }, select: { id: true } });
    return { runId: run.id, challengeId: challenge.id, code: challenge.code };
  });
}

// Random matching, asynchronously: join the oldest RANDOM challenge in this
// section/difficulty whose creator has already finished and that nobody
// else has joined; if there is none, open one and become the person the
// next student gets matched with. The creator-finished rule is what keeps
// an abandoned run from ever becoming somebody's opponent.
//
// Two students joining the same waiting challenge in the same instant could
// both pass the "one run" check and produce a three-run RANDOM challenge.
// That's a benign outcome (the results page ranks everyone in it) and at
// this product's scale not worth a row lock.
export async function startRandomRush(
  studentId: string,
  params: { section: ClubSection; difficulty: RushDifficulty },
): Promise<{ runId: string; challengeId: string; matched: boolean }> {
  return prisma.$transaction(async (tx) => {
    // "Exactly one run" can't be expressed in a where clause, so fetch the
    // oldest few candidates and take the first that still has only its
    // creator in it.
    const candidates = await tx.rushChallenge.findMany({
      where: {
        mode: "RANDOM",
        creatorId: { not: studentId },
        set: { section: params.section, difficulty: params.difficulty },
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
    const set = await createSet(studentId, params.section, params.difficulty, tx);
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
  difficulty: RushDifficulty;
  difficultyLabel: string;
  questionCount: number;
  limitMs: number;
  creatorName: string;
  creatorFinished: boolean;
  participants: number;
  // The viewer's own standing in it, so the join page can route them on.
  myRun: { id: string; status: "ACTIVE" | "COMPLETED" } | null;
  isCreator: boolean;
};

export async function getChallengePreview(studentId: string, code: string): Promise<ChallengePreview | null> {
  const c = await prisma.rushChallenge.findUnique({
    where: { code },
    include: {
      set: { select: { section: true, difficulty: true, _count: { select: { slots: true } } } },
      creator: { select: { firstName: true } },
      runs: { select: { id: true, studentId: true, status: true } },
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
    difficulty: c.set.difficulty,
    difficultyLabel: RUSH_DIFFICULTIES[c.set.difficulty].label,
    questionCount: c.set._count.slots,
    limitMs: RUSH_TIME_LIMIT_MS[c.set.section],
    creatorName: c.creator.firstName,
    creatorFinished: creatorRun?.status === "COMPLETED",
    participants: c.runs.length,
    myRun: mine ? { id: mine.id, status: mine.status } : null,
    isCreator: c.creatorId === studentId,
  };
}

// Accepting a friend's challenge — the free hook. Only FRIEND challenges are
// joinable by code: a SOLO run is one person's, and a RANDOM pairing is made
// by startRandomRush, not by handing out its code. Idempotent: a student who
// already has a run in the challenge gets that run back.
export async function joinChallenge(studentId: string, code: string): Promise<{ runId: string; challengeId: string }> {
  const c = await prisma.rushChallenge.findUnique({
    where: { code },
    select: { id: true, mode: true, runs: { where: { studentId }, select: { id: true } } },
  });
  if (!c) throw new RushError("CHALLENGE_NOT_FOUND", "No challenge has that code. Check it and try again.");
  if (c.runs[0]) return { runId: c.runs[0].id, challengeId: c.id };
  if (c.mode !== "FRIEND") throw new RushError("NOT_JOINABLE", "That rush isn't open to join.");
  const run = await prisma.rushRun.create({ data: { challengeId: c.id, studentId }, select: { id: true } });
  return { runId: run.id, challengeId: c.id };
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
  difficultyLabel: string;
  score: number;
  position: number;
  total: number;
  limitMs: number;
  // First name of a finished opponent whose times will ghost this run.
  opponentName: string | null;
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
    difficultyLabel: RUSH_DIFFICULTIES[run.challenge.set.difficulty].label,
    score: run.score,
    position: run.position,
    total: run.challenge.set._count.slots,
    limitMs: RUSH_TIME_LIMIT_MS[run.challenge.set.section],
    opponentName: run.challenge.runs[0]?.student.firstName ?? null,
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
        answers: { where: { position } },
      },
    });
    if (!run || run.studentId !== studentId) throw new RushError("RUN_NOT_FOUND", "Rush not found.");
    const slot = run.challenge.set.slots[0];
    if (!slot) throw new RushError("RUN_NOT_FOUND", "Question not found.");
    const total = await tx.rushSlot.count({ where: { setId: run.challenge.setId } });
    const revision = slot.questionRevision;
    const correctChoiceId = revision.answerChoices.find((c) => c.isCorrect)?.id ?? null;
    const acceptedAnswer = revision.acceptedAnswers[0] ?? null;

    const existing = run.answers[0];
    if (existing?.answeredAt) {
      return {
        isCorrect: existing.isCorrect ?? false,
        points: existing.points ?? 0,
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
    const points = scoreRushAnswer({ isCorrect, elapsedMs, limitMs });
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

    return { isCorrect, points, elapsedMs, timedOut: answer === null, overLimit: isOverLimit(elapsedMs, limitMs), score: updated.score, correctChoiceId, acceptedAnswer, done };
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
  answers: { position: number; isCorrect: boolean | null; points: number | null; elapsedMs: number | null; answered: boolean }[];
};

export type RushResults = {
  challengeId: string;
  code: string;
  mode: RushMode;
  section: ClubSection;
  sectionLabel: string;
  difficulty: RushDifficulty;
  difficultyLabel: string;
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
};

export async function getRushResults(studentId: string, challengeId: string): Promise<RushResults | null> {
  const c = await prisma.rushChallenge.findUnique({
    where: { id: challengeId },
    include: {
      set: { include: { slots: { orderBy: { position: "asc" }, include: { question: { select: { category: true, difficulty: true } } } } } },
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
    difficulty: c.set.difficulty,
    difficultyLabel: RUSH_DIFFICULTIES[c.set.difficulty].label,
    limitMs: RUSH_TIME_LIMIT_MS[c.set.section],
    total: c.set.slots.length,
    isCreator: c.creatorId === studentId,
    me: toParticipant(mine),
    others,
    outcome: best ? compareRuns(mine, best) : null,
    questions: c.set.slots.map((s) => ({ position: s.position, category: s.question.category, difficulty: s.question.difficulty })),
  };
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
  sectionLabel: string;
  difficultyLabel: string;
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
      sectionLabel: RUSH_SECTIONS[r.challenge.set.section].label,
      difficultyLabel: RUSH_DIFFICULTIES[r.challenge.set.difficulty].label,
      createdAt: r.startedAt,
      myRunId: r.id,
      myStatus: r.status,
      myScore: r.score,
      opponent: opp ? { name: opp.student.firstName, score: opp.score, finished: opp.status === "COMPLETED" } : null,
      outcome,
      awaitingFriend: r.challenge.mode === "FRIEND" && isCreator && r.challenge.runs.length === 0,
      awaitingMatch: r.challenge.mode === "RANDOM" && finished && r.challenge.runs.length === 0,
    };
  });

  return {
    pool: { READING_WRITING: poolCounts[0], MATH: poolCounts[1] },
    stats: { played, best, wins, losses, ties },
    history,
  };
}
