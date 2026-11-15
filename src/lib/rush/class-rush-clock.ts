import { RUSH_GRACE_MS } from "./config";

// The clock of a Class Rush (2026-11-15): one Rush the whole class plays at
// once. Pure, so the rules are tested apart from the database.
//
// A game is LOBBY until the teacher presses Start, then PLAYING through every
// question, then FINISHED. While PLAYING, each question goes
//   COUNTDOWN (opens in the future) → QUESTION (open) → REVEAL (closed) →
// and then the next question opens, until the last one's reveal ends.
// A question closes the moment everyone in the game has answered, or when its
// clock (plus the usual grace) runs out, whichever comes first, so a quick
// class never waits on the timer.

/** Before the first question: the projector's 5-4-3-2-1. */
export const CLASS_RUSH_COUNTDOWN_MS = 5_000;
/** After each question: the right answer and the leaderboard, then the next one opens. */
export const CLASS_RUSH_REVEAL_MS = 7_000;
/** How long a game a teacher can choose. */
export const CLASS_RUSH_SIZES = [5, 10] as const;
export type ClassRushSize = (typeof CLASS_RUSH_SIZES)[number];
/** A game nobody has touched for this long is over (a teacher who closed the tab). */
export const CLASS_RUSH_STALE_MS = 3 * 60 * 60 * 1000;

export type ClassRushPhase = "LOBBY" | "COUNTDOWN" | "QUESTION" | "REVEAL" | "FINISHED";

type ClockState = {
  status: "LOBBY" | "PLAYING" | "FINISHED";
  openedAt: Date | null;
  closedAt: Date | null;
};

export function classRushPhase(r: ClockState, now: number): ClassRushPhase {
  if (r.status === "LOBBY") return "LOBBY";
  if (r.status === "FINISHED") return "FINISHED";
  if (!r.openedAt || r.openedAt.getTime() > now) return "COUNTDOWN";
  return r.closedAt ? "REVEAL" : "QUESTION";
}

export type ClassRushStep = "NONE" | "CLOSE" | "NEXT" | "FINISH";

/** What should happen now, if anything. Every caller claims the step against the game's version. */
export function nextClassRushStep(
  r: ClockState & { position: number; total: number; players: number; answered: number; limitMs: number },
  now: number,
): ClassRushStep {
  if (r.status !== "PLAYING" || !r.openedAt) return "NONE";
  const opened = r.openedAt.getTime();
  if (now < opened) return "NONE";
  if (!r.closedAt) {
    const everyoneIn = r.players > 0 && r.answered >= r.players;
    const outOfTime = now >= opened + r.limitMs + RUSH_GRACE_MS;
    return everyoneIn || outOfTime ? "CLOSE" : "NONE";
  }
  if (now < r.closedAt.getTime() + CLASS_RUSH_REVEAL_MS) return "NONE";
  return r.position + 1 >= r.total ? "FINISH" : "NEXT";
}

/** Places for a list already sorted best first: equal scores share a place (1, 2, 2, 4). */
export function placesFor(scores: number[]): number[] {
  const places: number[] = [];
  scores.forEach((score, i) => {
    places.push(i > 0 && scores[i - 1] === score ? places[i - 1] : i + 1);
  });
  return places;
}
