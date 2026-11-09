import { Prisma, type GuidedItemKind, type GuidedPhase } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createRandom, generateSeed } from "@/lib/adaptive/random";
import { logUnauthorizedAccess } from "@/lib/logger";
import type { TeacherContext } from "@/lib/teacher/access";
import {
  ADD_TIME_SECONDS,
  REVOTE_SECONDS,
  TALK_SECONDS,
  THINK_SECONDS,
  sectionOf,
} from "./config";
import { cleanAnswer, grade, loadRevision, type RevisionInfo } from "./content";
import { classStudentIds, publishedCandidates, seenCounts } from "./create";
import { GuidedError } from "./errors";
import { commandAllowed } from "./modes";
import { createOwnSlots } from "./own";
import { chooseQuestion } from "./select";
import { forgetSharedState } from "./state";

type Tx = Prisma.TransactionClient;
type Patch = Prisma.GuidedSessionUpdateManyMutationInput;

/** A session this teacher runs, at their school, or a logged refusal that reads as "not found". */
export async function requireOwnedSession(context: TeacherContext, sessionId: string) {
  const session = await prisma.guidedSession.findUnique({
    where: { id: sessionId },
    include: {
      classroom: { select: { teacherId: true, schoolId: true, name: true, id: true } },
      items: { orderBy: { position: "asc" }, include: { question: { select: { category: true } } } },
    },
  });
  if (!session || session.teacherId !== context.userId || session.classroom.schoolId !== context.schoolId) {
    if (session) {
      logUnauthorizedAccess("Teacher attempted to access another teacher's Guided Session", {
        accountId: context.userId,
        affectedResourceId: sessionId,
      });
    }
    throw new GuidedError("NOT_FOUND", "Session not found.");
  }
  return session;
}

type OwnedSession = Awaited<ReturnType<typeof requireOwnedSession>>;
type Item = OwnedSession["items"][number];

export type GuidedCommand =
  | { type: "NEXT" }
  | { type: "TALK" }
  | { type: "REVOTE" }
  | { type: "REVEAL" }
  | { type: "EXPLAIN" }
  | { type: "TWIN" }
  | { type: "STEP"; delta: number }
  | { type: "ADD_TIME" }
  | { type: "PAUSE"; paused: boolean }
  | { type: "SKIP" }
  | { type: "OWN" }
  | { type: "RECAP" }
  | { type: "END" }
  | { type: "ENTER_ANSWER"; studentId: string; answer: string };

const ANSWERABLE: GuidedItemKind[] = ["CLASS", "TWIN"];

function secondsFromNow(now: Date, seconds: number): Date {
  return new Date(now.getTime() + seconds * 1000);
}

/**
 * Turns choices still on screen into answers when the room moves on: the
 * rule students are told is "when time's up, whatever you've chosen is your
 * answer". Graded in the database in one statement per vote.
 *
 * `skipExtraTime` leaves students with an extended-time accommodation alone
 * when partners start talking: their clock isn't the room's, and they can
 * still send their first answer until the reveal.
 */
async function finalizeDrafts(
  tx: Tx,
  sessionId: string,
  itemId: string,
  info: RevisionInfo,
  vote: 1 | 2,
  now: Date,
  skipExtraTime = false,
) {
  const value = vote === 1 ? Prisma.sql`"draft"` : Prisma.sql`COALESCE("draft", "firstAnswer")`;
  const correctId = info.choices.find((c) => c.isCorrect)?.id ?? "";
  const accepted = info.acceptedAnswers.map((a) => a.trim().toLowerCase());
  const isCorrect =
    info.questionType === "MULTIPLE_CHOICE"
      ? Prisma.sql`(${value} = ${correctId})`
      : Prisma.sql`(lower(btrim(${value})) = ANY(${accepted}::text[]))`;
  const extraTime = skipExtraTime
    ? Prisma.sql`AND "studentId" NOT IN (SELECT "studentId" FROM "guided_participants" WHERE "sessionId" = ${sessionId} AND "extraTime" <> 'NONE')`
    : Prisma.empty;
  if (vote === 1) {
    await tx.$executeRaw`
      UPDATE "guided_responses"
         SET "firstAnswer" = "draft", "firstCorrect" = ${isCorrect}, "firstAt" = ${now}
       WHERE "itemId" = ${itemId} AND "firstAnswer" IS NULL AND "draft" IS NOT NULL AND "catchUp" = false ${extraTime}`;
  } else {
    await tx.$executeRaw`
      UPDATE "guided_responses"
         SET "secondAnswer" = COALESCE("draft", "firstAnswer"), "secondCorrect" = ${isCorrect}, "secondAt" = ${now}
       WHERE "itemId" = ${itemId} AND "secondAnswer" IS NULL AND COALESCE("draft", "firstAnswer") IS NOT NULL AND "catchUp" = false`;
  }
}

/**
 * One teacher action. Every action is claimed against the session's
 * `version`, so a double click or two open consoles can't apply it twice:
 * the second finds the version moved and does nothing.
 */
export async function runCommand(context: TeacherContext, sessionId: string, command: GuidedCommand, now: Date = new Date()) {
  const session = await requireOwnedSession(context, sessionId);
  if (session.status === "ENDED") throw new GuidedError("ENDED", "This session has ended.");
  if (!commandAllowed(session.mode, command.type)) {
    throw new GuidedError("NOT_NOW", "That isn't available in an individual practice session. Students are working at their own pace.");
  }

  const items = session.items;
  const current = items.find((i) => i.position === session.position) ?? null;
  const warmup = items.find((i) => i.kind === "WARMUP") ?? null;
  const example = items.find((i) => i.kind === "EXAMPLE") ?? null;
  const thinkSeconds = THINK_SECONDS[sectionOf(session.category)];

  const effects: ((tx: Tx) => Promise<unknown>)[] = [];
  let patch: Patch | null = null;

  const openItem = (item: Item): Patch => {
    effects.push((tx) => tx.guidedItem.update({ where: { id: item.id }, data: { openedAt: now } }));
    return {
      phase: "THINK",
      position: item.position,
      step: 0,
      paused: false,
      phaseStartedAt: now,
      phaseEndsAt: secondsFromNow(now, thinkSeconds),
    };
  };
  const nextAnswerable = (after: number) => items.find((i) => i.position > after && ANSWERABLE.includes(i.kind)) ?? null;
  const firstAnswerable = () => items.find((i) => i.kind === "CLASS") ?? null;

  const startOwn = async (): Promise<Patch> => {
    const participants = await prisma.guidedParticipant.findMany({
      where: { sessionId, onPaper: false },
      select: { studentId: true },
    });
    const create = await createOwnSlots(session, participants.map((p) => p.studentId));
    effects.push((tx) => create(tx));
    return { phase: "OWN", paused: false, phaseStartedAt: now, phaseEndsAt: secondsFromNow(now, session.ownSeconds) };
  };

  const reveal = async (item: Item): Promise<Patch> => {
    const info = await loadRevision(item.questionRevisionId);
    effects.push((tx) => finalizeDrafts(tx, sessionId, item.id, info, 1, now));
    if (item.talked || session.phase === "REVOTE") effects.push((tx) => finalizeDrafts(tx, sessionId, item.id, info, 2, now));
    effects.push((tx) => tx.guidedItem.update({ where: { id: item.id }, data: { revealedAt: now } }));
    return { phase: "REVEAL", paused: false, step: 0, phaseStartedAt: now, phaseEndsAt: null };
  };

  const advance = async (): Promise<Patch> => {
    switch (session.phase as GuidedPhase) {
      case "LOBBY":
        if (warmup) return { ...(await reveal(warmup)), position: warmup.position, startedAt: now };
        return { phase: "PLAN", startedAt: now, phaseStartedAt: now, phaseEndsAt: null };
      case "PLAN":
        if (example) return { phase: "EXAMPLE", position: example.position, step: 0, phaseStartedAt: now, phaseEndsAt: null };
        return firstAnswerable() ? openItem(firstAnswerable()!) : startOwn();
      case "EXAMPLE":
        return firstAnswerable() ? openItem(firstAnswerable()!) : startOwn();
      case "THINK":
      case "TALK":
      case "REVOTE":
        if (!current) throw new GuidedError("NOT_NOW", "There's no question open.");
        if (session.phase === "TALK") return { phase: "REVOTE", phaseStartedAt: now, phaseEndsAt: secondsFromNow(now, REVOTE_SECONDS) };
        return reveal(current);
      case "REVEAL":
      case "EXPLAIN": {
        if (current?.kind === "WARMUP") return { phase: "PLAN", phaseStartedAt: now, phaseEndsAt: null, step: 0 };
        const next = nextAnswerable(session.position);
        return next ? openItem(next) : startOwn();
      }
      case "OWN":
        return { phase: "RECAP", paused: false, phaseStartedAt: now, phaseEndsAt: null };
      case "RECAP":
        return { status: "ENDED", endedAt: now, paused: false, phaseEndsAt: null };
    }
  };

  const requirePhase = (...phases: GuidedPhase[]) => {
    if (!phases.includes(session.phase)) throw new GuidedError("NOT_NOW", "That isn't available right now.");
  };

  switch (command.type) {
    case "NEXT":
      patch = await advance();
      break;
    case "TALK": {
      requirePhase("THINK");
      if (!current) throw new GuidedError("NOT_NOW", "There's no question open.");
      const info = await loadRevision(current.questionRevisionId);
      effects.push((tx) => finalizeDrafts(tx, sessionId, current.id, info, 1, now, true));
      effects.push((tx) => tx.guidedItem.update({ where: { id: current.id }, data: { talked: true } }));
      patch = { phase: "TALK", paused: false, phaseStartedAt: now, phaseEndsAt: secondsFromNow(now, TALK_SECONDS) };
      break;
    }
    case "REVOTE":
      requirePhase("TALK");
      patch = { phase: "REVOTE", phaseStartedAt: now, phaseEndsAt: secondsFromNow(now, REVOTE_SECONDS) };
      break;
    case "REVEAL":
      requirePhase("THINK", "TALK", "REVOTE");
      if (!current) throw new GuidedError("NOT_NOW", "There's no question open.");
      patch = await reveal(current);
      break;
    case "EXPLAIN":
      requirePhase("REVEAL");
      patch = { phase: "EXPLAIN", step: 0, phaseStartedAt: now, phaseEndsAt: null };
      break;
    case "STEP": {
      requirePhase("EXAMPLE", "EXPLAIN");
      if (!current) throw new GuidedError("NOT_NOW", "There's nothing on the board.");
      const total = (await loadRevision(current.questionRevisionId)).steps.length;
      const step = Math.max(0, Math.min(session.step + Math.sign(command.delta), Math.max(total - 1, 0)));
      if (step === session.step) return;
      patch = { step };
      break;
    }
    case "TWIN": {
      requirePhase("REVEAL", "EXPLAIN");
      if (!current || !ANSWERABLE.includes(current.kind)) throw new GuidedError("NOT_NOW", "There's no question to follow.");
      const studentIds = await classStudentIds(session.classroomId);
      const [candidates, seen] = await Promise.all([
        publishedCandidates(session.category),
        seenCounts(studentIds, session.category),
      ]);
      const twin = chooseQuestion({
        candidates,
        difficulty: current.difficulty,
        used: new Set(items.map((i) => i.questionId)),
        seenBy: seen,
        random: createRandom(generateSeed()),
      });
      if (!twin) throw new GuidedError("NO_CONTENT", "There isn't another question like this one in the bank yet.");
      const position = session.position + 1;
      effects.push((tx) =>
        tx.$executeRaw`UPDATE "guided_items" SET "position" = "position" + 1 WHERE "sessionId" = ${sessionId} AND "position" >= ${position}`,
      );
      effects.push((tx) =>
        tx.guidedItem.create({
          data: {
            sessionId,
            position,
            kind: "TWIN",
            questionId: twin.questionId,
            questionRevisionId: twin.questionRevisionId,
            difficulty: twin.difficulty,
            openedAt: now,
          },
        }),
      );
      patch = {
        phase: "THINK",
        position,
        step: 0,
        paused: false,
        phaseStartedAt: now,
        phaseEndsAt: secondsFromNow(now, thinkSeconds),
      };
      break;
    }
    case "ADD_TIME": {
      requirePhase("THINK", "TALK", "REVOTE", "OWN");
      const base = session.phaseEndsAt && session.phaseEndsAt > now ? session.phaseEndsAt : now;
      patch = { phaseEndsAt: secondsFromNow(base, ADD_TIME_SECONDS) };
      break;
    }
    case "PAUSE":
      if (session.paused === command.paused) return;
      patch = { paused: command.paused };
      break;
    case "SKIP": {
      requirePhase("THINK", "TALK", "REVOTE", "REVEAL", "EXPLAIN", "EXAMPLE");
      const next = nextAnswerable(session.position);
      patch = next ? openItem(next) : await startOwn();
      break;
    }
    case "OWN":
      if (session.phase === "LOBBY" || session.phase === "OWN" || session.phase === "RECAP") {
        throw new GuidedError("NOT_NOW", "That isn't available right now.");
      }
      patch = await startOwn();
      break;
    case "RECAP":
      requirePhase("OWN");
      patch = { phase: "RECAP", paused: false, phaseStartedAt: now, phaseEndsAt: null };
      break;
    case "END":
      patch = { status: "ENDED", endedAt: now, paused: false, phaseEndsAt: null, ...(session.phase !== "RECAP" ? { phase: "RECAP" as const } : {}) };
      break;
    case "ENTER_ANSWER": {
      await enterAnswerOnPaper(session, command.studentId, command.answer, now);
      forgetSharedState(session.stateKey);
      return;
    }
  }

  if (!patch) return;
  const claim = patch;
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.guidedSession.updateMany({
      where: { id: sessionId, version: session.version, status: "OPEN" },
      data: { ...claim, version: { increment: 1 } },
    });
    if (claimed.count === 0) return;
    for (const effect of effects) await effect(tx);
  });
  forgetSharedState(session.stateKey);
}

/**
 * A student answering on paper (no working laptop): the teacher taps their
 * row and a letter. The answer goes to whichever vote is open.
 */
async function enterAnswerOnPaper(session: OwnedSession, studentId: string, rawAnswer: string, now: Date) {
  const answer = cleanAnswer(rawAnswer);
  if (!answer) throw new GuidedError("INVALID_INPUT", "Choose an answer.");
  const enrolled = await prisma.classroomEnrollment.findFirst({
    where: { classroomId: session.classroomId, studentId, removedAt: null },
    select: { id: true },
  });
  if (!enrolled) throw new GuidedError("NOT_IN_CLASS", "That student isn't in this class.");

  const item =
    session.phase === "LOBBY"
      ? session.items.find((i) => i.kind === "WARMUP")
      : ["THINK", "TALK", "REVOTE"].includes(session.phase)
        ? session.items.find((i) => i.position === session.position)
        : undefined;
  if (!item) throw new GuidedError("NOT_NOW", "There's no question open to answer.");
  const info = await loadRevision(item.questionRevisionId);
  // The console sends a letter's position ("#2" for C), never a choice id it doesn't have.
  const byIndex = /^#(\d)$/.exec(answer);
  const value = byIndex && info.questionType === "MULTIPLE_CHOICE" ? info.choices[Number(byIndex[1])]?.id : answer;
  if (!value) throw new GuidedError("INVALID_INPUT", "Choose an answer.");
  const correct = grade(info, value);
  const vote = session.phase === "REVOTE" ? 2 : 1;

  await prisma.$transaction(async (tx) => {
    await tx.guidedParticipant.upsert({
      where: { sessionId_studentId: { sessionId: session.id, studentId } },
      create: { sessionId: session.id, studentId, onPaper: true },
      update: {},
    });
    const data =
      vote === 1
        ? { firstAnswer: value, firstCorrect: correct, firstAt: now, draft: null, enteredByTeacher: true }
        : { secondAnswer: value, secondCorrect: correct, secondAt: now, draft: null, enteredByTeacher: true };
    await tx.guidedResponse.upsert({
      where: { itemId_studentId: { itemId: item.id, studentId } },
      create: { sessionId: session.id, itemId: item.id, studentId, ...data },
      update: data,
    });
  });
}
