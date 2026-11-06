import type { ExtraTime, GuidedConfidence, GuidedItemKind, GuidedPace } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { StudentQuestionContent } from "@/lib/session/question-content";
import { answerLabel } from "@/lib/teacher/answer-stats";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import { CATCH_UP_DAYS, EXTRA_TIME_FACTOR } from "./config";
import { answerKeyOf, cleanAnswer, correctChoiceId, grade, loadRevision, loadRevisions, type RevisionInfo } from "./content";
import { GuidedError } from "./errors";
import { createBonusSlot, createOwnSlots } from "./own";
import { itemLabels, reachedItem } from "./report";
import { forgetSharedState, itemForPhase } from "./state";

const DAY_MS = 24 * 60 * 60 * 1000;
const ANSWERABLE: GuidedItemKind[] = ["WARMUP", "CLASS", "TWIN"];

/** What a student sees after answering one of their own questions, or in the catch-up. */
export type Feedback = {
  isCorrect: boolean;
  answer: string;
  correctChoiceId: string | null;
  acceptedAnswers: string[];
  steps: { text: string; imageId: string | null }[];
  /** Why the choice they made is wrong, when it is and a note exists. */
  distractor: string | null;
};

function feedbackFor(info: RevisionInfo, answer: string, isCorrect: boolean): Feedback {
  return {
    isCorrect,
    answer,
    correctChoiceId: correctChoiceId(info),
    acceptedAnswers: info.acceptedAnswers,
    steps: info.steps,
    distractor: isCorrect ? null : (info.choices.find((c) => c.id === answer)?.distractor ?? null),
  };
}

export type OwnSlotView = {
  id: string;
  position: number;
  bonus: boolean;
  content: StudentQuestionContent;
  feedback: Feedback | null;
};

export type PersonalState = {
  sessionId: string;
  joined: boolean;
  extraTime: ExtraTime;
  pace: GuidedPace | null;
  /** This student's answers to the question the room is on. */
  response: {
    itemId: string;
    draft: string | null;
    firstAnswer: string | null;
    secondAnswer: string | null;
    confidence: GuidedConfidence | null;
  } | null;
  own: { slots: OwnSlotView[]; finished: boolean; seconds: number } | null;
  /** Class questions opened before this student joined. */
  missedBeforeJoining: number;
};

async function loadSession(sessionId: string) {
  const session = await prisma.guidedSession.findUnique({
    where: { id: sessionId },
    include: { items: { orderBy: { position: "asc" } }, classroom: { select: { archivedAt: true } } },
  });
  if (!session) throw new GuidedError("NOT_FOUND", "Session not found.");
  return session;
}
type LoadedSession = Awaited<ReturnType<typeof loadSession>>;

async function enrollment(classroomId: string, studentId: string) {
  return prisma.classroomEnrollment.findFirst({
    where: { classroomId, studentId, removedAt: null },
    select: { extraTime: true, lastName: true },
  });
}

/** A session the student may be in: their class's, and the class still open. */
async function requireStudentSession(studentId: string, sessionId: string) {
  const session = await loadSession(sessionId);
  const enrolled = await enrollment(session.classroomId, studentId);
  if (!enrolled || session.classroom.archivedAt) throw new GuidedError("NOT_IN_CLASS", "This session is for another class.");
  return { session, enrolled };
}

/** For the page: the session if this student belongs in it, and whether they've joined. */
export async function getStudentSession(studentId: string, sessionId: string) {
  const session = await prisma.guidedSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      stateKey: true,
      status: true,
      classroomId: true,
      classroom: { select: { name: true, joinCode: true, archivedAt: true } },
    },
  });
  if (!session) return null;
  const enrolled = await enrollment(session.classroomId, studentId);
  return { ...session, enrolled: !!enrolled && !session.classroom.archivedAt };
}

export async function joinGuidedSession(studentId: string, sessionId: string): Promise<void> {
  const { session, enrolled } = await requireStudentSession(studentId, sessionId);
  if (session.status === "ENDED") throw new GuidedError("ENDED", "This session has ended.");
  await prisma.guidedParticipant.upsert({
    where: { sessionId_studentId: { sessionId, studentId } },
    create: { sessionId, studentId, extraTime: enrolled.extraTime },
    update: { onPaper: false, lastSeenAt: new Date(), hidden: false, extraTime: enrolled.extraTime },
  });
  // Arriving after the own questions were dealt: deal theirs now.
  if (session.phase === "OWN" || session.phase === "RECAP") {
    const create = await createOwnSlots(session, [studentId]);
    await prisma.$transaction(async (tx) => create(tx));
  }
  forgetSharedState(session.stateKey);
}

export async function getPersonalState(studentId: string, sessionId: string): Promise<PersonalState> {
  const { session, enrolled } = await requireStudentSession(studentId, sessionId);
  const participant = await prisma.guidedParticipant.findUnique({
    where: { sessionId_studentId: { sessionId, studentId } },
  });
  const current = itemForPhase(session.phase, session.position, session.items);
  const response = current
    ? await prisma.guidedResponse.findUnique({ where: { itemId_studentId: { itemId: current.id, studentId } } })
    : null;

  let own: PersonalState["own"] = null;
  if (participant && (session.phase === "OWN" || session.phase === "RECAP" || session.status === "ENDED")) {
    const slots = await prisma.guidedOwnSlot.findMany({ where: { sessionId, studentId }, orderBy: { position: "asc" } });
    const infos = await loadRevisions(slots.map((s) => s.questionRevisionId));
    own = {
      slots: slots.map((s) => {
        const info = infos.get(s.questionRevisionId)!;
        return {
          id: s.id,
          position: s.position,
          bonus: s.bonus,
          content: info.content,
          feedback: s.answer !== null ? feedbackFor(info, s.answer, !!s.isCorrect) : null,
        };
      }),
      finished: !!participant.ownFinishedAt,
      seconds: Math.round(session.ownSeconds * EXTRA_TIME_FACTOR[participant.extraTime]),
    };
  }

  const missedBeforeJoining = participant
    ? session.items.filter((i) => (i.kind === "CLASS" || i.kind === "TWIN") && i.openedAt && i.openedAt < participant.joinedAt).length
    : 0;

  return {
    sessionId,
    joined: !!participant && !participant.onPaper,
    extraTime: participant?.extraTime ?? enrolled.extraTime,
    pace: participant?.pace ?? null,
    response:
      current && current.kind !== "EXAMPLE"
        ? {
            itemId: current.id,
            draft: response?.draft ?? null,
            firstAnswer: response?.firstAnswer ?? null,
            secondAnswer: response?.secondAnswer ?? null,
            confidence: response?.confidence ?? null,
          }
        : null,
    own,
    missedBeforeJoining,
  };
}

/** Which vote, if any, this student can send to this item right now. */
function openVote(session: LoadedSession, itemId: string, extraTime: ExtraTime, firstAnswer: string | null): 1 | 2 | null {
  if (session.status !== "OPEN" || session.paused) return null;
  const current = itemForPhase(session.phase, session.position, session.items);
  if (!current || current.id !== itemId || current.kind === "EXAMPLE") return null;
  const extended = extraTime !== "NONE";
  switch (session.phase) {
    case "LOBBY":
    case "THINK":
      return 1;
    case "TALK":
      // Partners are talking; a student with extra time is still allowed to
      // finish their first answer.
      return extended && firstAnswer === null ? 1 : null;
    case "REVOTE":
      return extended && firstAnswer === null ? 1 : 2;
    default:
      return null;
  }
}

async function requireParticipant(sessionId: string, studentId: string) {
  const participant = await prisma.guidedParticipant.findUnique({ where: { sessionId_studentId: { sessionId, studentId } } });
  if (!participant) throw new GuidedError("NOT_NOW", "Join the session first.");
  return participant;
}

export async function saveGuidedDraft(studentId: string, sessionId: string, itemId: string, rawDraft: string | null): Promise<void> {
  const { session } = await requireStudentSession(studentId, sessionId);
  const participant = await requireParticipant(sessionId, studentId);
  const existing = await prisma.guidedResponse.findUnique({ where: { itemId_studentId: { itemId, studentId } } });
  const vote = openVote(session, itemId, participant.extraTime, existing?.firstAnswer ?? null);
  if (!vote) return;
  const draft = rawDraft === null ? null : cleanAnswer(rawDraft);
  await prisma.guidedResponse.upsert({
    where: { itemId_studentId: { itemId, studentId } },
    create: { sessionId, itemId, studentId, draft },
    update: { draft },
  });
}

/**
 * Sends an answer to the open vote. Idempotent: a vote already recorded is
 * kept (a double tap, or a retry after a dropped connection, changes nothing).
 */
export async function submitGuidedAnswer(
  studentId: string,
  sessionId: string,
  itemId: string,
  rawAnswer: string,
): Promise<{ vote: 1 | 2 }> {
  const answer = cleanAnswer(rawAnswer);
  if (!answer) throw new GuidedError("INVALID_INPUT", "Choose an answer first.");
  const { session } = await requireStudentSession(studentId, sessionId);
  const participant = await requireParticipant(sessionId, studentId);
  const existing = await prisma.guidedResponse.findUnique({ where: { itemId_studentId: { itemId, studentId } } });
  const vote = openVote(session, itemId, participant.extraTime, existing?.firstAnswer ?? null);
  if (!vote) {
    // Already recorded is success; anything else is the room having moved on.
    if (existing?.firstAnswer && (session.phase !== "REVOTE" || existing.secondAnswer)) return { vote: existing.secondAnswer ? 2 : 1 };
    throw new GuidedError("NOT_NOW", "The room has moved on from this question.");
  }
  const item = session.items.find((i) => i.id === itemId)!;
  const correct = grade(await loadRevision(item.questionRevisionId), answer);
  const now = new Date();
  await prisma.guidedResponse.upsert({
    where: { itemId_studentId: { itemId, studentId } },
    create: { sessionId, itemId, studentId },
    update: {},
  });
  if (vote === 1) {
    await prisma.guidedResponse.updateMany({
      where: { itemId, studentId, firstAnswer: null },
      data: { firstAnswer: answer, firstCorrect: correct, firstAt: now, draft: null },
    });
  } else {
    await prisma.guidedResponse.updateMany({
      where: { itemId, studentId, secondAnswer: null },
      data: { secondAnswer: answer, secondCorrect: correct, secondAt: now, draft: null },
    });
  }
  forgetSharedState(session.stateKey);
  return { vote };
}

export async function setGuidedConfidence(studentId: string, sessionId: string, itemId: string, confidence: GuidedConfidence) {
  await requireStudentSession(studentId, sessionId);
  await prisma.guidedResponse.updateMany({
    where: { itemId, studentId, sessionId, firstAnswer: { not: null }, catchUp: false },
    data: { confidence },
  });
}

export async function setGuidedPace(studentId: string, sessionId: string, pace: GuidedPace) {
  await prisma.guidedParticipant.updateMany({ where: { sessionId, studentId }, data: { pace } });
}

/** The screen's check-in: presence for the teacher's "Away". */
export async function guidedHeartbeat(studentId: string, sessionId: string, hidden: boolean) {
  await prisma.guidedParticipant.updateMany({
    where: { sessionId, studentId, onPaper: false },
    data: { lastSeenAt: new Date(), hidden },
  });
}

/** One of the student's own questions. Right or wrong, with the explanation, straight away. */
export async function submitOwnAnswer(studentId: string, slotId: string, rawAnswer: string): Promise<Feedback> {
  const answer = cleanAnswer(rawAnswer);
  if (!answer) throw new GuidedError("INVALID_INPUT", "Choose an answer first.");
  const slot = await prisma.guidedOwnSlot.findUnique({ where: { id: slotId }, include: { session: true } });
  if (!slot || slot.studentId !== studentId) throw new GuidedError("NOT_FOUND", "Question not found.");
  const info = await loadRevision(slot.questionRevisionId);
  if (slot.answer !== null) return feedbackFor(info, slot.answer, !!slot.isCorrect);
  if (slot.session.status !== "OPEN") throw new GuidedError("ENDED", "This session has ended. You can try it again from your recap.");
  const isCorrect = grade(info, answer);
  const now = new Date();
  const written = await prisma.guidedOwnSlot.updateMany({
    where: { id: slotId, answer: null },
    data: { answer, isCorrect, answeredAt: now },
  });
  if (written.count > 0 && !slot.bonus) {
    const left = await prisma.guidedOwnSlot.count({
      where: { sessionId: slot.sessionId, studentId, bonus: false, answer: null },
    });
    if (left === 0) {
      await prisma.guidedParticipant.updateMany({
        where: { sessionId: slot.sessionId, studentId, ownFinishedAt: null },
        data: { ownFinishedAt: now },
      });
      forgetSharedState(slot.session.stateKey);
    }
  }
  const stored = written.count > 0 ? { answer, isCorrect } : await prisma.guidedOwnSlot.findUniqueOrThrow({ where: { id: slotId } });
  return feedbackFor(info, stored.answer ?? answer, !!stored.isCorrect);
}

export async function requestGuidedBonus(studentId: string, sessionId: string): Promise<boolean> {
  const { session } = await requireStudentSession(studentId, sessionId);
  if (session.status !== "OPEN") return false;
  await requireParticipant(sessionId, studentId);
  return createBonusSlot(session, studentId);
}

// ---------------------------------------------------------------------------
// After the session: the recap, a second try at own questions, and the
// catch-up for students who were absent or joined late.
// ---------------------------------------------------------------------------

export type RecapQuestion = {
  itemId: string;
  kind: GuidedItemKind;
  label: string;
  correctLabel: string;
  firstAnswer: string | null;
  firstCorrect: boolean | null;
  secondAnswer: string | null;
  secondCorrect: boolean | null;
  catchUp: boolean;
};

export type StudentRecap = {
  className: string;
  categoryLabel: string;
  endedAt: Date | null;
  joined: boolean;
  questions: RecapQuestion[];
  own: { id: string; bonus: boolean; content: StudentQuestionContent; feedback: Feedback | null; retry: Feedback | null }[];
  takeaways: string[];
  /** Questions the room did that this student hasn't answered, while catch-up is open. */
  catchUp: { itemId: string; label: string; content: StudentQuestionContent }[];
  pace: GuidedPace | null;
};

export async function getStudentRecap(studentId: string, sessionId: string, now: Date = new Date()): Promise<StudentRecap> {
  const { session } = await requireStudentSession(studentId, sessionId);
  const [participant, responses, own, classroom] = await Promise.all([
    prisma.guidedParticipant.findUnique({ where: { sessionId_studentId: { sessionId, studentId } } }),
    prisma.guidedResponse.findMany({ where: { sessionId, studentId } }),
    prisma.guidedOwnSlot.findMany({ where: { sessionId, studentId }, orderBy: { position: "asc" } }),
    prisma.classroom.findUniqueOrThrow({ where: { id: session.classroomId }, select: { name: true } }),
  ]);
  const labels = itemLabels(session.items);
  const infos = await loadRevisions([
    ...session.items.map((i) => i.questionRevisionId),
    ...own.map((s) => s.questionRevisionId),
  ]);
  const answerable = session.items.filter((i) => ANSWERABLE.includes(i.kind) && reachedItem(i));
  const questions: RecapQuestion[] = answerable
    .map((item) => {
      const r = responses.find((x) => x.itemId === item.id);
      const info = infos.get(item.questionRevisionId)!;
      return {
        itemId: item.id,
        kind: item.kind,
        label: labels.get(item.id) ?? "",
        correctLabel: answerLabel(answerKeyOf(info), correctChoiceId(info) ?? info.acceptedAnswers[0] ?? null),
        firstAnswer: r?.firstAnswer ? answerLabel(answerKeyOf(info), r.firstAnswer) : null,
        firstCorrect: r?.firstCorrect ?? null,
        secondAnswer: r?.secondAnswer ? answerLabel(answerKeyOf(info), r.secondAnswer) : null,
        secondCorrect: r?.secondCorrect ?? null,
        catchUp: r?.catchUp ?? false,
      };
    });

  const catchUpOpen = session.status === "ENDED" && !!session.endedAt && now.getTime() - session.endedAt.getTime() < CATCH_UP_DAYS * DAY_MS;
  const catchUp = catchUpOpen
    ? answerable
        .filter((item) => !responses.some((r) => r.itemId === item.id && (r.firstAnswer !== null || r.secondAnswer !== null)))
        .map((item) => ({
          itemId: item.id,
          label: labels.get(item.id) ?? "",
          content: infos.get(item.questionRevisionId)!.content,
        }))
    : [];

  const takeaways = [
    ...new Set(
      session.items
        .filter((i) => i.kind !== "WARMUP")
        .map((i) => infos.get(i.questionRevisionId)?.takeaway)
        .filter((t): t is string => !!t),
    ),
  ].slice(0, 3);

  return {
    className: classroom.name,
    categoryLabel: CATEGORY_LABELS[session.category],
    endedAt: session.endedAt,
    joined: !!participant,
    questions,
    own: own.map((s) => {
      const info = infos.get(s.questionRevisionId)!;
      return {
        id: s.id,
        bonus: s.bonus,
        content: info.content,
        feedback: s.answer !== null ? feedbackFor(info, s.answer, !!s.isCorrect) : null,
        retry: s.retryAnswer !== null ? feedbackFor(info, s.retryAnswer, !!s.retryCorrect) : null,
      };
    }),
    takeaways,
    catchUp,
    pace: participant?.pace ?? null,
  };
}

/** A second try at an own question the student missed or didn't reach, after the session. */
export async function submitOwnRetry(studentId: string, slotId: string, rawAnswer: string): Promise<Feedback> {
  const answer = cleanAnswer(rawAnswer);
  if (!answer) throw new GuidedError("INVALID_INPUT", "Choose an answer first.");
  const slot = await prisma.guidedOwnSlot.findUnique({ where: { id: slotId } });
  if (!slot || slot.studentId !== studentId) throw new GuidedError("NOT_FOUND", "Question not found.");
  const info = await loadRevision(slot.questionRevisionId);
  if (slot.retryAnswer !== null) return feedbackFor(info, slot.retryAnswer, !!slot.retryCorrect);
  if (slot.isCorrect) throw new GuidedError("NOT_NOW", "You already got this one.");
  const isCorrect = grade(info, answer);
  await prisma.guidedOwnSlot.updateMany({ where: { id: slotId, retryAnswer: null }, data: { retryAnswer: answer, retryCorrect: isCorrect } });
  return feedbackFor(info, answer, isCorrect);
}

/** A question the room did, answered afterwards by a student who missed it. */
export async function submitCatchUpAnswer(studentId: string, itemId: string, rawAnswer: string, now: Date = new Date()): Promise<Feedback> {
  const answer = cleanAnswer(rawAnswer);
  if (!answer) throw new GuidedError("INVALID_INPUT", "Choose an answer first.");
  const item = await prisma.guidedItem.findUnique({ where: { id: itemId }, select: { sessionId: true, kind: true, questionRevisionId: true } });
  if (!item || !ANSWERABLE.includes(item.kind)) throw new GuidedError("NOT_FOUND", "Question not found.");
  const { session } = await requireStudentSession(studentId, item.sessionId);
  if (session.status !== "ENDED" || !session.endedAt || now.getTime() - session.endedAt.getTime() >= CATCH_UP_DAYS * DAY_MS) {
    throw new GuidedError("NOT_NOW", "The catch-up for this session isn't open.");
  }
  const info = await loadRevision(item.questionRevisionId);
  const existing = await prisma.guidedResponse.findUnique({ where: { itemId_studentId: { itemId, studentId } } });
  if (existing?.firstAnswer) return feedbackFor(info, existing.firstAnswer, !!existing.firstCorrect);
  const isCorrect = grade(info, answer);
  await prisma.guidedResponse.upsert({
    where: { itemId_studentId: { itemId, studentId } },
    create: { sessionId: item.sessionId, itemId, studentId, firstAnswer: answer, firstCorrect: isCorrect, firstAt: now, catchUp: true },
    update: { firstAnswer: answer, firstCorrect: isCorrect, firstAt: now, catchUp: true, draft: null },
  });
  return feedbackFor(info, answer, isCorrect);
}
