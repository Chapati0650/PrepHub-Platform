import type { ClubSection, RushLiveStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isAnswerCorrect } from "@/lib/adaptive/grading";
import { getStudentQuestionContent, type StudentQuestionContent } from "@/lib/session/question-content";
import {
  LIVE_COUNTDOWN_MS,
  LIVE_GAP_MS,
  LIVE_LOBBY_STALE_MS,
  LIVE_PRESENCE_MS,
  RUSH_DIFFICULTY,
  RUSH_GRACE_MS,
  RUSH_SECTIONS,
  RUSH_TIME_LIMIT_MS,
} from "./config";
import { createChallenge, createSet } from "./create";
import { scoreRushAnswer } from "./scoring";
import { RushError } from "./errors";

// Live head-to-head rooms. Two players, one server-side clock, no
// WebSockets (this host can't hold one open): both clients poll
// getLiveState once a second, and every poll also runs tickLive, which is
// what moves the room forward — from COUNTDOWN to PLAYING when the timer
// hits zero, and from one question to the next once both have answered
// or the limit has passed. Because either player's poll can advance the
// room, the advance is an atomic updateMany guarded on the position it
// expects to leave; the loser of that race simply reads the new state.
//
// Elapsed time is still server-measured (now − livePositionStartedAt), so
// the two players are timed on the same clock, and neither browser
// reports a duration.

export type LiveRoundAnswer = { isCorrect: boolean; points: number; elapsedMs: number; timedOut: boolean };

export type LiveState = {
  challengeId: string;
  code: string;
  mode: "FRIEND" | "RANDOM";
  section: ClubSection;
  sectionLabel: string;
  total: number;
  limitMs: number;
  status: RushLiveStatus;
  isCreator: boolean;
  // How long the creator has been alone in the lobby — the client offers a
  // recorded opponent once this passes LIVE_RANDOM_FALLBACK_MS.
  waitedMs: number;
  startsInMs: number | null; // COUNTDOWN
  position: number; // PLAYING: the question both are on
  questionOpen: boolean; // PLAYING and the shared clock has started
  remainingMs: number; // PLAYING: time left on the open question
  nextStartsInMs: number | null; // PLAYING, between questions
  me: { name: string; score: number; correctCount: number; answered: LiveRoundAnswer | null };
  opponent: { name: string; score: number; correctCount: number; present: boolean; answered: LiveRoundAnswer | null } | null;
  // The round that just closed, for the pause between questions.
  lastRound: { position: number; me: LiveRoundAnswer | null; opponent: LiveRoundAnswer | null } | null;
};

// ---- Rooms ------------------------------------------------------------------

export async function createLiveRoom(studentId: string, params: { section: ClubSection; mode: "FRIEND" | "RANDOM" }) {
  return prisma.$transaction(async (tx) => {
    const set = await createSet(studentId, params.section, RUSH_DIFFICULTY, tx);
    const challenge = await createChallenge(tx, { setId: set.id, mode: params.mode, creatorId: studentId, live: true, liveStatus: "WAITING" });
    await tx.rushRun.create({ data: { challengeId: challenge.id, studentId } });
    return { challengeId: challenge.id, code: challenge.code };
  });
}

// The WAITING → COUNTDOWN transition, claimed atomically so two people
// can't both become the second player. Idempotent for someone already in
// the room.
export async function joinLiveRoom(studentId: string, challengeId: string): Promise<{ runId: string; challengeId: string }> {
  const existing = await prisma.rushRun.findUnique({ where: { challengeId_studentId: { challengeId, studentId } }, select: { id: true } });
  if (existing) return { runId: existing.id, challengeId };

  const c = await prisma.rushChallenge.findUnique({
    where: { id: challengeId },
    select: { live: true, liveStatus: true, runs: { select: { lastSeenAt: true } } },
  });
  if (!c || !c.live) throw new RushError("CHALLENGE_NOT_FOUND", "That room doesn't exist.");
  if (c.liveStatus !== "WAITING") throw new RushError("NOT_JOINABLE", "That rush has already started.");
  const creatorPresent = c.runs.some((r) => Date.now() - r.lastSeenAt.getTime() < LIVE_PRESENCE_MS);
  if (!creatorPresent) throw new RushError("NOT_JOINABLE", "Nobody's in that room right now. Ask them to open it again, then try the link.");

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.rushChallenge.updateMany({
      where: { id: challengeId, liveStatus: "WAITING" },
      data: { liveStatus: "COUNTDOWN", liveStartsAt: new Date(Date.now() + LIVE_COUNTDOWN_MS) },
    });
    if (claimed.count === 0) throw new RushError("NOT_JOINABLE", "Someone else just joined that room.");
    const run = await tx.rushRun.create({ data: { challengeId, studentId }, select: { id: true } });
    return { runId: run.id, challengeId };
  });
}

// Random, live: take the oldest lobby in this section whose creator is
// still polling; otherwise open one and wait.
export async function startLiveRandom(studentId: string, section: ClubSection): Promise<{ challengeId: string; matched: boolean }> {
  const lobbies = await prisma.rushChallenge.findMany({
    where: {
      live: true,
      liveStatus: "WAITING",
      mode: "RANDOM",
      creatorId: { not: studentId },
      set: { section },
      runs: { some: { lastSeenAt: { gt: new Date(Date.now() - LIVE_LOBBY_STALE_MS) } } },
    },
    orderBy: { createdAt: "asc" },
    take: 5,
    select: { id: true },
  });
  for (const lobby of lobbies) {
    try {
      const joined = await joinLiveRoom(studentId, lobby.id);
      return { challengeId: joined.challengeId, matched: true };
    } catch (err) {
      if (err instanceof RushError && err.code === "NOT_JOINABLE") continue; // taken between the query and the claim
      throw err;
    }
  }
  const room = await createLiveRoom(studentId, { section, mode: "RANDOM" });
  return { challengeId: room.challengeId, matched: false };
}

// Leaving a lobby nobody has joined removes it (the set goes with it).
// Anything past WAITING is a match in progress and stays.
export async function cancelLiveRoom(studentId: string, challengeId: string): Promise<boolean> {
  const c = await prisma.rushChallenge.findUnique({ where: { id: challengeId }, select: { setId: true, creatorId: true, live: true, liveStatus: true } });
  if (!c || !c.live || c.creatorId !== studentId || c.liveStatus !== "WAITING") return false;
  await prisma.rushSet.delete({ where: { id: c.setId } });
  return true;
}

// ---- The clock --------------------------------------------------------------

async function loadRoom(challengeId: string) {
  return prisma.rushChallenge.findUnique({
    where: { id: challengeId },
    include: {
      set: { select: { section: true, _count: { select: { slots: true } } } },
      runs: { include: { student: { select: { firstName: true } }, answers: true } },
    },
  });
}
type Room = NonNullable<Awaited<ReturnType<typeof loadRoom>>>;

// Moves the room forward if it's due. Safe to call from every poll and
// every submit; every write is guarded on the state it expects to leave.
export async function tickLive(challengeId: string): Promise<void> {
  const c = await loadRoom(challengeId);
  if (!c || !c.live) return;
  const now = new Date();

  if (c.liveStatus === "COUNTDOWN" && c.liveStartsAt && c.liveStartsAt <= now) {
    await prisma.rushChallenge.updateMany({
      where: { id: challengeId, liveStatus: "COUNTDOWN" },
      data: { liveStatus: "PLAYING", livePosition: 0, livePositionStartedAt: c.liveStartsAt },
    });
    return;
  }
  if (c.liveStatus !== "PLAYING" || !c.livePositionStartedAt || c.livePositionStartedAt > now) return;

  const pos = c.livePosition;
  const total = c.set._count.slots;
  const limitMs = RUSH_TIME_LIMIT_MS[c.set.section];
  const startedAt = c.livePositionStartedAt;
  const allAnswered = c.runs.every((r) => r.answers.some((a) => a.position === pos && a.answeredAt));
  const expired = now.getTime() >= startedAt.getTime() + limitMs + RUSH_GRACE_MS;
  if (!allAnswered && !expired) return;

  await prisma.$transaction(async (tx) => {
    const last = pos + 1 >= total;
    const claimed = await tx.rushChallenge.updateMany({
      where: { id: challengeId, liveStatus: "PLAYING", livePosition: pos },
      data: last ? { liveStatus: "FINISHED" } : { livePosition: pos + 1, livePositionStartedAt: new Date(now.getTime() + LIVE_GAP_MS) },
    });
    if (claimed.count === 0) return; // the other player's poll got here first

    // Whoever hasn't answered is timed out — but only rows still blank, so
    // an answer that landed between the read above and this write is kept.
    for (const r of c.runs) {
      const row = r.answers.find((a) => a.position === pos);
      const timeout = { answeredAt: now, answer: null, isCorrect: false, elapsedMs: limitMs, points: 0 };
      let timedOut = false;
      if (!row) {
        await tx.rushAnswer.create({ data: { runId: r.id, position: pos, servedAt: startedAt, ...timeout } });
        timedOut = true;
      } else if (!row.answeredAt) {
        const res = await tx.rushAnswer.updateMany({ where: { id: row.id, answeredAt: null }, data: timeout });
        timedOut = res.count > 0;
      }
      await tx.rushRun.update({
        where: { id: r.id },
        data: {
          position: pos + 1,
          ...(timedOut ? { totalMs: { increment: limitMs } } : {}),
          ...(last ? { status: "COMPLETED", completedAt: now } : {}),
        },
      });
    }
  });
}

// ---- State for the client ------------------------------------------------

function roundOf(room: Room, runId: string, position: number): LiveRoundAnswer | null {
  const a = room.runs.find((r) => r.id === runId)?.answers.find((x) => x.position === position);
  if (!a?.answeredAt) return null;
  return { isCorrect: a.isCorrect ?? false, points: a.points ?? 0, elapsedMs: a.elapsedMs ?? 0, timedOut: a.answer === null };
}

export async function getLiveState(studentId: string, challengeId: string): Promise<LiveState | null> {
  // Presence first, then advance, then read — so the state returned already
  // reflects anything this poll itself moved.
  const touched = await prisma.rushRun.updateMany({ where: { challengeId, studentId }, data: { lastSeenAt: new Date() } });
  if (touched.count === 0) return null;
  await tickLive(challengeId);
  const c = await loadRoom(challengeId);
  if (!c || !c.live || !c.liveStatus || c.mode === "SOLO") return null;
  const now = Date.now();
  const me = c.runs.find((r) => r.studentId === studentId)!;
  const opp = c.runs.find((r) => r.studentId !== studentId) ?? null;
  const limitMs = RUSH_TIME_LIMIT_MS[c.set.section];
  const startedAt = c.livePositionStartedAt?.getTime() ?? null;
  const playing = c.liveStatus === "PLAYING" && startedAt !== null;
  const questionOpen = playing && startedAt! <= now;
  const pos = c.livePosition;

  return {
    challengeId: c.id,
    code: c.code,
    mode: c.mode,
    section: c.set.section,
    sectionLabel: RUSH_SECTIONS[c.set.section].label,
    total: c.set._count.slots,
    limitMs,
    status: c.liveStatus,
    isCreator: c.creatorId === studentId,
    waitedMs: now - c.createdAt.getTime(),
    startsInMs: c.liveStatus === "COUNTDOWN" && c.liveStartsAt ? Math.max(0, c.liveStartsAt.getTime() - now) : null,
    position: pos,
    questionOpen,
    remainingMs: questionOpen ? Math.max(0, startedAt! + limitMs - now) : 0,
    nextStartsInMs: playing && !questionOpen ? Math.max(0, startedAt! - now) : null,
    me: { name: me.student.firstName, score: me.score, correctCount: me.correctCount, answered: playing ? roundOf(c, me.id, pos) : null },
    opponent: opp
      ? {
          name: opp.student.firstName,
          score: opp.score,
          correctCount: opp.correctCount,
          present: now - opp.lastSeenAt.getTime() < LIVE_PRESENCE_MS,
          answered: playing ? roundOf(c, opp.id, pos) : null,
        }
      : null,
    lastRound:
      playing && pos > 0 ? { position: pos - 1, me: roundOf(c, me.id, pos - 1), opponent: opp ? roundOf(c, opp.id, pos - 1) : null } : null,
  };
}

export type LiveServedQuestion = { position: number; remainingMs: number; content: StudentQuestionContent };

// The current question, once its shared clock has opened. Also records
// that this player has seen it (servedAt = the shared start, not "now" —
// both players are timed from the same instant).
export async function serveLiveQuestion(studentId: string, challengeId: string): Promise<LiveServedQuestion> {
  const c = await prisma.rushChallenge.findUnique({
    where: { id: challengeId },
    include: {
      set: { select: { section: true, slots: { select: { position: true, questionRevisionId: true } } } },
      runs: { where: { studentId }, select: { id: true } },
    },
  });
  const run = c?.runs[0];
  if (!c || !c.live || !run) throw new RushError("RUN_NOT_FOUND", "Room not found.");
  if (c.liveStatus !== "PLAYING" || !c.livePositionStartedAt) throw new RushError("NOT_SERVED", "The next question hasn't started.");
  const startedAt = c.livePositionStartedAt.getTime();
  if (startedAt > Date.now()) throw new RushError("NOT_SERVED", "The next question hasn't started.");
  const slot = c.set.slots.find((s) => s.position === c.livePosition);
  if (!slot) throw new RushError("NOT_SERVED", "Question not found.");

  await prisma.rushAnswer.upsert({
    where: { runId_position: { runId: run.id, position: c.livePosition } },
    create: { runId: run.id, position: c.livePosition, servedAt: c.livePositionStartedAt },
    update: {},
  });
  const content = await getStudentQuestionContent(slot.questionRevisionId);
  return { position: c.livePosition, remainingMs: Math.max(0, startedAt + RUSH_TIME_LIMIT_MS[c.set.section] - Date.now()), content };
}

export type LiveAnswerResult = LiveRoundAnswer & { score: number; correctChoiceId: string | null; acceptedAnswer: string | null };

export async function submitLiveAnswer(params: { studentId: string; challengeId: string; position: number; answer: string | null }): Promise<LiveAnswerResult> {
  const { studentId, challengeId, position, answer } = params;
  const result = await prisma.$transaction(async (tx) => {
    const c = await tx.rushChallenge.findUnique({
      where: { id: challengeId },
      include: {
        set: {
          select: {
            section: true,
            slots: { where: { position }, include: { question: true, questionRevision: { include: { answerChoices: true } } } },
          },
        },
        runs: { where: { studentId }, include: { answers: { where: { position } } } },
      },
    });
    const run = c?.runs[0];
    const slot = c?.set.slots[0];
    if (!c || !c.live || !run || !slot) throw new RushError("RUN_NOT_FOUND", "Room not found.");
    const revision = slot.questionRevision;
    const correctChoiceId = revision.answerChoices.find((x) => x.isCorrect)?.id ?? null;
    const acceptedAnswer = revision.acceptedAnswers[0] ?? null;
    const stored = (row: (typeof run.answers)[number]): LiveAnswerResult => ({
      isCorrect: row.isCorrect ?? false,
      points: row.points ?? 0,
      elapsedMs: row.elapsedMs ?? 0,
      timedOut: row.answer === null,
      score: run.score,
      correctChoiceId,
      acceptedAnswer,
    });

    const existing = run.answers[0];
    if (existing?.answeredAt) return stored(existing);
    if (c.liveStatus !== "PLAYING" || c.livePosition !== position || !c.livePositionStartedAt) {
      throw new RushError("RUN_COMPLETED", "That question is over.");
    }
    const now = new Date();
    const startedAt = c.livePositionStartedAt;
    if (startedAt > now) throw new RushError("NOT_SERVED", "The question hasn't started.");

    const limitMs = RUSH_TIME_LIMIT_MS[c.set.section];
    const elapsedMs = Math.max(0, now.getTime() - startedAt.getTime());
    const isCorrect = answer !== null && answer !== "" && isAnswerCorrect(slot.question.questionType, answer, revision);
    const points = scoreRushAnswer({ isCorrect, elapsedMs, limitMs });
    const data = { answeredAt: now, answer, isCorrect, elapsedMs, points };

    if (existing) {
      const res = await tx.rushAnswer.updateMany({ where: { id: existing.id, answeredAt: null }, data });
      if (res.count === 0) {
        const row = await tx.rushAnswer.findUniqueOrThrow({ where: { id: existing.id } });
        return stored(row);
      }
    } else {
      await tx.rushAnswer.create({ data: { runId: run.id, position, servedAt: startedAt, ...data } });
    }
    const updated = await tx.rushRun.update({
      where: { id: run.id },
      data: {
        score: { increment: points },
        correctCount: { increment: isCorrect ? 1 : 0 },
        totalMs: { increment: Math.min(elapsedMs, limitMs) },
      },
      select: { score: true },
    });
    return { isCorrect, points, elapsedMs, timedOut: answer === null, score: updated.score, correctChoiceId, acceptedAnswer };
  });
  // Both answered? Then this call is what moves the room on.
  await tickLive(challengeId);
  return result;
}
