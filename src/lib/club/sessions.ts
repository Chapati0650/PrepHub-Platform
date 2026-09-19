import type { ClubSection } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createRandom, generateSeed } from "@/lib/adaptive/random";
import { isAnswerCorrect } from "@/lib/adaptive/grading";
import { CLUB_SECTION_ORDER, CLUB_SECTIONS, CLUB_SESSION_SIZE } from "./config";
import { selectClubQuestions } from "./select-questions";
import { ClubError } from "./errors";

// Everything here is deliberately independent of src/lib/adaptive: the 800
// Club never reads or writes CategoryState, PracticeSet, FinalizedAttempt or
// PredictionHistoryEntry. It borrows two pure helpers (the seeded PRNG and
// the answer grader) and nothing that carries state.

export type ClubSectionOverview = {
  section: ClubSection;
  label: string;
  blurb: string;
  questionCount: number;
  activeSessionId: string | null;
};

export type ClubAnalytics = {
  attempted: number;
  correct: number;
  accuracy: number | null; // percent, null until something has been attempted
  sessionsCompleted: number;
  // Derived the same way the dashboard derives study time (session
  // createdAt→completedAt spread evenly across its questions — CLAUDE.md's
  // "known simplification"); null until a session has been completed.
  averageSecondsPerQuestion: number | null;
};

async function countPool(section: ClubSection): Promise<number> {
  return prisma.question.count({
    where: {
      status: "PUBLISHED",
      difficulty: "HARD",
      category: { in: [...CLUB_SECTIONS[section].categories] },
      currentPublishedRevisionId: { not: null },
    },
  });
}

export async function getClubOverview(studentId: string): Promise<{ sections: ClubSectionOverview[]; analytics: ClubAnalytics }> {
  const [counts, active, slots, completedSessions] = await Promise.all([
    Promise.all(CLUB_SECTION_ORDER.map(countPool)),
    prisma.clubSession.findMany({ where: { studentId, status: "ACTIVE" }, select: { id: true, section: true } }),
    prisma.clubSlot.findMany({
      where: { session: { studentId }, finalizedAt: { not: null } },
      select: { isCorrect: true },
    }),
    prisma.clubSession.findMany({
      where: { studentId, status: "COMPLETED" },
      select: { createdAt: true, completedAt: true, _count: { select: { slots: true } } },
    }),
  ]);

  const sections = CLUB_SECTION_ORDER.map((section, i) => ({
    section,
    label: CLUB_SECTIONS[section].label,
    blurb: CLUB_SECTIONS[section].blurb,
    questionCount: counts[i],
    activeSessionId: active.find((a) => a.section === section)?.id ?? null,
  }));

  const attempted = slots.length;
  const correct = slots.filter((s) => s.isCorrect).length;
  let totalSeconds = 0;
  let timedQuestions = 0;
  for (const s of completedSessions) {
    if (!s.completedAt || s._count.slots === 0) continue;
    totalSeconds += (s.completedAt.getTime() - s.createdAt.getTime()) / 1000;
    timedQuestions += s._count.slots;
  }

  return {
    sections,
    analytics: {
      attempted,
      correct,
      accuracy: attempted > 0 ? Math.round((correct / attempted) * 100) : null,
      sessionsCompleted: completedSessions.length,
      averageSecondsPerQuestion: timedQuestions > 0 ? Math.round(totalSeconds / timedQuestions) : null,
    },
  };
}

// Returns the student's ACTIVE session for the section, or creates one. One
// active session per section (not per student): a student can leave a Math
// session half-done and open Reading & Writing without losing it.
export async function openClubSession(studentId: string, section: ClubSection): Promise<{ id: string }> {
  const existing = await prisma.clubSession.findFirst({ where: { studentId, section, status: "ACTIVE" }, select: { id: true } });
  if (existing) return existing;

  const [candidates, seen] = await Promise.all([
    prisma.question.findMany({
      where: {
        status: "PUBLISHED",
        difficulty: "HARD",
        category: { in: [...CLUB_SECTIONS[section].categories] },
        currentPublishedRevisionId: { not: null },
      },
      select: { id: true, currentPublishedRevisionId: true },
    }),
    prisma.clubSlot.findMany({
      where: { session: { studentId }, finalizedAt: { not: null } },
      select: { questionId: true },
      distinct: ["questionId"],
    }),
  ]);

  const randomSeed = generateSeed();
  const picked = selectClubQuestions({
    candidates: candidates.map((c) => ({ questionId: c.id, questionRevisionId: c.currentPublishedRevisionId! })),
    seenQuestionIds: new Set(seen.map((s) => s.questionId)),
    size: CLUB_SESSION_SIZE,
    random: createRandom(randomSeed),
  });
  if (picked.length === 0) {
    throw new ClubError("NO_QUESTIONS", "There are no 800 Club questions in this section yet.");
  }

  return prisma.clubSession.create({
    data: {
      studentId,
      section,
      randomSeed,
      slots: {
        create: picked.map((p, position) => ({ position, questionId: p.questionId, questionRevisionId: p.questionRevisionId })),
      },
    },
    select: { id: true },
  });
}

// Idempotent: a retried submit returns the first recorded answer rather than
// grading again. The check and the write are one transaction.
export async function finalizeClubAnswer(params: { studentId: string; slotId: string; answer: string }) {
  return prisma.$transaction(async (tx) => {
    const slot = await tx.clubSlot.findUnique({
      where: { id: params.slotId },
      include: { session: true, question: true, questionRevision: { include: { answerChoices: true } } },
    });
    if (!slot || slot.session.studentId !== params.studentId) {
      throw new ClubError("SLOT_NOT_FOUND", "Question not found.");
    }
    if (slot.finalizedAt) return { isCorrect: slot.isCorrect ?? false, answer: slot.answer ?? "" };
    if (slot.session.status === "COMPLETED") {
      throw new ClubError("SESSION_COMPLETED", "This session is already complete.");
    }

    const isCorrect = isAnswerCorrect(slot.question.questionType, params.answer, slot.questionRevision);
    await tx.clubSlot.update({
      where: { id: slot.id },
      data: { answer: params.answer, isCorrect, finalizedAt: new Date(), draftAnswer: null, skipped: false },
    });
    return { isCorrect, answer: params.answer };
  });
}

// Same product rule as a Practice Set (PRD-005 §21): every question must be
// answered before the session completes. No blank-confirmation bypass.
export async function completeClubSession(studentId: string, sessionId: string): Promise<void> {
  const session = await prisma.clubSession.findUnique({ where: { id: sessionId }, include: { slots: { select: { finalizedAt: true } } } });
  if (!session || session.studentId !== studentId) throw new ClubError("SESSION_NOT_FOUND", "Session not found.");
  if (session.status === "COMPLETED") return;
  const unanswered = session.slots.filter((s) => !s.finalizedAt).length;
  if (unanswered > 0) throw new ClubError("BLANKS_REMAIN", `${unanswered} question${unanswered === 1 ? "" : "s"} remain unanswered.`, { unanswered });
  await prisma.clubSession.update({ where: { id: sessionId }, data: { status: "COMPLETED", completedAt: new Date() } });
}

export async function getClubSessionForRunner(studentId: string, sessionId: string) {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    include: { slots: { orderBy: { position: "asc" } } },
  });
  if (!session || session.studentId !== studentId) return null;
  return session;
}

export type ClubResults = {
  sessionId: string;
  section: ClubSection;
  sectionLabel: string;
  total: number;
  correct: number;
  accuracy: number;
  totalSeconds: number | null;
  questions: { slotId: string; position: number; isCorrect: boolean; category: string }[];
};

export async function getClubResults(studentId: string, sessionId: string): Promise<ClubResults | null> {
  const session = await prisma.clubSession.findUnique({
    where: { id: sessionId },
    include: { slots: { orderBy: { position: "asc" }, include: { question: { select: { category: true } } } } },
  });
  if (!session || session.studentId !== studentId || session.status !== "COMPLETED") return null;
  const total = session.slots.length;
  const correct = session.slots.filter((s) => s.isCorrect).length;
  return {
    sessionId: session.id,
    section: session.section,
    sectionLabel: CLUB_SECTIONS[session.section].label,
    total,
    correct,
    accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
    totalSeconds: session.completedAt ? Math.round((session.completedAt.getTime() - session.createdAt.getTime()) / 1000) : null,
    questions: session.slots.map((s) => ({ slotId: s.id, position: s.position, isCorrect: s.isCorrect ?? false, category: s.question.category })),
  };
}
