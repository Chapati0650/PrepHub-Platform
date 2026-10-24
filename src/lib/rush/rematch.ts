import { prisma } from "@/lib/prisma";
import { LIVE_LOBBY_STALE_MS, RUSH_DIFFICULTY, RUSH_SECTIONS } from "./config";
import { createChallenge, createSet, isUniqueViolation } from "./create";
import { RushError } from "./errors";
import { joinLiveRoom } from "./live";

/**
 * Rematches (2026-10-24).
 *
 * A rematch is a new FRIEND challenge between the same two students, in the
 * same section and the same style — live if the match was live, recorded if
 * it was recorded — on a fresh set of questions. It records which match it's
 * a rematch of (`rematchOfId`, unique) and the one student it's for
 * (`invitedStudentId`).
 *
 * **How the other player finds out.** There is no push notification, so the
 * invitation shows in the two places they're likely to be: the results page
 * of the match they just played (which polls), and their Rush hub.
 *
 * **Both pressing Rematch at once** is the case the unique `rematchOfId`
 * exists for. The second insert fails on the constraint, outside the
 * transaction that attempted it, and that player simply joins the room the
 * first one opened — rather than each sitting in their own room waiting for
 * the other.
 *
 * Starting a rematch is Premium, like starting any rush; accepting one is
 * free, like accepting any friend challenge. The paid check lives in the
 * action, as it does for every other start.
 */

export type RematchState =
  /** Solo, still in progress, or no opponent has finished: no rematch to offer. */
  | { kind: "UNAVAILABLE" }
  /** A rematch can be requested. */
  | { kind: "NONE"; opponentName: string }
  /** This student asked; for a live rematch they wait in the room. */
  | { kind: "SENT"; challengeId: string; live: boolean; runId: string | null; opponentName: string }
  /** The opponent asked and it can still be accepted. */
  | { kind: "RECEIVED"; challengeId: string; live: boolean; opponentName: string }
  /** Both in it, not finished: where to go back to. */
  | { kind: "IN_PROGRESS"; challengeId: string; live: boolean; runId: string }
  /** This student has finished the rematch. */
  | { kind: "PLAYED"; challengeId: string };

export type RematchDestination = { live: true; challengeId: string } | { live: false; challengeId: string; runId: string };

async function loadMatch(challengeId: string) {
  return prisma.rushChallenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      mode: true,
      live: true,
      set: { select: { section: true } },
      runs: {
        select: { studentId: true, status: true, student: { select: { firstName: true } } },
        orderBy: [{ score: "desc" }, { totalMs: "asc" }],
      },
      rematch: {
        select: {
          id: true,
          live: true,
          liveStatus: true,
          creatorId: true,
          invitedStudentId: true,
          runs: { select: { id: true, studentId: true, status: true, lastSeenAt: true } },
        },
      },
    },
  });
}
type Match = NonNullable<Awaited<ReturnType<typeof loadMatch>>>;
type Rematch = NonNullable<Match["rematch"]>;

/** The finished player this student would rematch — the same one the results page compares against. */
function opponentIn(match: Match, studentId: string) {
  const mine = match.runs.find((r) => r.studentId === studentId);
  if (match.mode === "SOLO" || mine?.status !== "COMPLETED") return null;
  return match.runs.find((r) => r.studentId !== studentId && r.status === "COMPLETED") ?? null;
}

/**
 * A live rematch room whose creator stopped polling is dead: the invitation
 * can't be accepted (joinLiveRoom refuses an absent host), so it shouldn't be
 * offered, and it shouldn't block a new rematch either.
 */
function isStaleLobby(rematch: Rematch): boolean {
  if (!rematch.live || rematch.liveStatus !== "WAITING") return false;
  const creatorRun = rematch.runs.find((r) => r.studentId === rematch.creatorId);
  return !creatorRun || Date.now() - creatorRun.lastSeenAt.getTime() > LIVE_LOBBY_STALE_MS;
}

export async function getRematchState(studentId: string, challengeId: string): Promise<RematchState> {
  const match = await loadMatch(challengeId);
  if (!match) return { kind: "UNAVAILABLE" };
  const opponent = opponentIn(match, studentId);
  if (!opponent) return { kind: "UNAVAILABLE" };
  const opponentName = opponent.student.firstName;

  const rematch = match.rematch;
  if (!rematch) return { kind: "NONE", opponentName };

  const myRun = rematch.runs.find((r) => r.studentId === studentId);
  if (myRun?.status === "COMPLETED") return { kind: "PLAYED", challengeId: rematch.id };

  // Someone else's rematch — possible in a friend challenge a code was shared
  // around in, where the rematch is between two of the others.
  const mineToPlay = rematch.creatorId === studentId || rematch.invitedStudentId === studentId;
  if (!mineToPlay) return { kind: "UNAVAILABLE" };

  if (isStaleLobby(rematch)) return { kind: "NONE", opponentName };

  if (rematch.creatorId === studentId) {
    return { kind: "SENT", challengeId: rematch.id, live: rematch.live, runId: myRun?.id ?? null, opponentName };
  }
  if (myRun) return { kind: "IN_PROGRESS", challengeId: rematch.id, live: rematch.live, runId: myRun.id };
  return { kind: "RECEIVED", challengeId: rematch.id, live: rematch.live, opponentName };
}

/**
 * Asks for a rematch, or — if the opponent already asked — accepts theirs.
 * Idempotent for a student who already asked.
 */
export async function requestRematch(studentId: string, challengeId: string): Promise<RematchDestination> {
  const match = await loadMatch(challengeId);
  if (!match) throw new RushError("CHALLENGE_NOT_FOUND", "That rush doesn't exist.");
  const opponent = opponentIn(match, studentId);
  if (!opponent) throw new RushError("NOT_JOINABLE", "There's nobody to rematch in that rush.");

  if (match.rematch) {
    const existing = match.rematch;
    if (isStaleLobby(existing)) {
      // A room the other player opened and walked away from. Clear it so this
      // student can open a fresh one; the set cascades with the challenge.
      await prisma.rushSet.deleteMany({ where: { challenges: { some: { id: existing.id, liveStatus: "WAITING" } } } });
    } else if (existing.invitedStudentId === studentId) {
      return acceptRematch(studentId, existing.id);
    } else if (existing.creatorId === studentId) {
      return destinationFor(studentId, existing.id, existing.live);
    } else {
      throw new RushError("NOT_JOINABLE", "That rush has already been rematched.");
    }
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const set = await createSet(studentId, match.set.section, RUSH_DIFFICULTY, tx);
      const challenge = await createChallenge(tx, {
        setId: set.id,
        mode: "FRIEND",
        creatorId: studentId,
        live: match.live,
        liveStatus: match.live ? "WAITING" : undefined,
        rematchOfId: match.id,
        invitedStudentId: opponent.studentId,
      });
      const run = await tx.rushRun.create({ data: { challengeId: challenge.id, studentId }, select: { id: true } });
      return { challengeId: challenge.id, runId: run.id };
    });
    return match.live
      ? { live: true, challengeId: created.challengeId }
      : { live: false, challengeId: created.challengeId, runId: created.runId };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // The opponent's Rematch landed between our read and our insert. Theirs
    // is the rematch now: join it.
    const winner = await prisma.rushChallenge.findUnique({
      where: { rematchOfId: match.id },
      select: { id: true, live: true, creatorId: true, invitedStudentId: true },
    });
    if (!winner) throw err;
    if (winner.invitedStudentId === studentId) return acceptRematch(studentId, winner.id);
    if (winner.creatorId === studentId) return destinationFor(studentId, winner.id, winner.live);
    throw new RushError("NOT_JOINABLE", "That rush has already been rematched.");
  }
}

/**
 * Accepts a rematch this student was invited to. Free — no paid check, the
 * same as accepting any friend challenge. Only the invited student can.
 */
export async function acceptRematch(studentId: string, rematchId: string): Promise<RematchDestination> {
  const rematch = await prisma.rushChallenge.findUnique({
    where: { id: rematchId },
    select: { id: true, live: true, invitedStudentId: true, creatorId: true, runs: { where: { studentId }, select: { id: true } } },
  });
  if (!rematch || (rematch.invitedStudentId !== studentId && rematch.creatorId !== studentId)) {
    throw new RushError("CHALLENGE_NOT_FOUND", "That rematch isn't open to you.");
  }
  if (rematch.runs[0]) return destinationFor(studentId, rematch.id, rematch.live);

  if (rematch.live) {
    await joinLiveRoom(studentId, rematch.id);
    return { live: true, challengeId: rematch.id };
  }
  const run = await prisma.rushRun.create({ data: { challengeId: rematch.id, studentId }, select: { id: true } });
  return { live: false, challengeId: rematch.id, runId: run.id };
}

async function destinationFor(studentId: string, challengeId: string, live: boolean): Promise<RematchDestination> {
  if (live) return { live: true, challengeId };
  const run = await prisma.rushRun.findUnique({
    where: { challengeId_studentId: { challengeId, studentId } },
    select: { id: true },
  });
  if (!run) throw new RushError("RUN_NOT_FOUND", "Rush not found.");
  return { live: false, challengeId, runId: run.id };
}

export type RematchInvite = {
  challengeId: string;
  fromName: string;
  sectionLabel: string;
  live: boolean;
  sentAt: Date;
};

/** How long an unanswered recorded rematch stays on the hub. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Open invitations for the hub: rematches sent to this student that they
 * haven't joined. A live one only while its sender is still in the room —
 * an invitation to a room nobody's in can't be accepted, so it isn't shown.
 */
export async function listRematchInvites(studentId: string): Promise<RematchInvite[]> {
  const rows = await prisma.rushChallenge.findMany({
    where: {
      invitedStudentId: studentId,
      createdAt: { gte: new Date(Date.now() - INVITE_TTL_MS) },
      runs: { none: { studentId } },
      OR: [{ live: false }, { live: true, liveStatus: "WAITING" }],
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      live: true,
      liveStatus: true,
      createdAt: true,
      creatorId: true,
      creator: { select: { firstName: true } },
      set: { select: { section: true } },
      runs: { select: { studentId: true, lastSeenAt: true } },
    },
  });
  return rows
    .filter((r) => {
      if (!r.live) return true;
      const host = r.runs.find((x) => x.studentId === r.creatorId);
      return Boolean(host && Date.now() - host.lastSeenAt.getTime() <= LIVE_LOBBY_STALE_MS);
    })
    .map((r) => ({
      challengeId: r.id,
      fromName: r.creator.firstName,
      sectionLabel: RUSH_SECTIONS[r.set.section].label,
      live: r.live,
      sentAt: r.createdAt,
    }));
}
