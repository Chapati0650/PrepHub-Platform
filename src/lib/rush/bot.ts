import type { QuestionDifficulty } from "@/generated/prisma/client";
import { RUSH_BOT_AFTER_MS } from "./config";
import { scoreRushAnswerWithStreak } from "./scoring";

// The practice opponent for 1v1 Rush. Everything here is pure and seeded: the
// same profile always plays the same match, so the room can recompute the
// bot's whole run on every poll instead of storing a row per answer. The only
// thing persisted is the profile (RushChallenge.bot).
//
// How it plays, so it can win or lose against a real student:
// - Accuracy per question is the chance the *student's own ability* gives them
//   on that question (the caller supplies it), nudged by a per-match "form"
//   and per-question jitter. No ability on file falls back to a flat guess
//   per difficulty.
// - Timing is log-normal around a fraction of the clock that grows with
//   difficulty, scaled by a per-match speed factor, with a reading floor and
//   an occasional long pause. Wrong answers take a little longer, and now and
//   then a hard question simply runs out the clock.

export type BotProfile = {
  v: 1;
  seed: number;
  name: string;
  /** Index into BOT_AVATARS. */
  avatar: number;
  /** Multiplies every answer time; below 1 is quicker than typical. */
  speed: number;
  /** Per question, in position order. */
  difficulties: QuestionDifficulty[];
  pCorrect: number[];
};

export type BotRound = { position: number; isCorrect: boolean; timedOut: boolean; elapsedMs: number; points: number };

// ---- Fixed lists --------------------------------------------------------------

// First names only, mixed and common among US high schoolers.
export const BOT_NAMES = [
  "Maya", "Ethan", "Sofia", "Jordan", "Priya", "Marcus", "Chloe", "Daniel", "Aaliyah", "Noah",
  "Isabella", "Caleb", "Hannah", "Mateo", "Zoe", "Andre", "Grace", "Kevin", "Leila", "Owen",
  "Tessa", "Rohan", "Nina", "Elijah", "Camila", "Jasmine", "Lucas", "Avery", "Dev", "Rachel",
] as const;

export const BOT_AVATARS = [
  { bg: "#1d4ed8", fg: "#ffffff" },
  { bg: "#0f766e", fg: "#ffffff" },
  { bg: "#b45309", fg: "#ffffff" },
  { bg: "#be123c", fg: "#ffffff" },
  { bg: "#6d28d9", fg: "#ffffff" },
  { bg: "#15803d", fg: "#ffffff" },
  { bg: "#0369a1", fg: "#ffffff" },
  { bg: "#a21caf", fg: "#ffffff" },
] as const;

export type BotAvatar = { initial: string; bg: string; fg: string };

export function botAvatar(profile: Pick<BotProfile, "name" | "avatar">): BotAvatar {
  const a = BOT_AVATARS[profile.avatar % BOT_AVATARS.length];
  return { initial: profile.name.charAt(0).toUpperCase(), bg: a.bg, fg: a.fg };
}

// ---- Tuning ---------------------------------------------------------------------

/** Chance of a correct answer when the student has no ability on file. */
export const BOT_DEFAULT_P: Record<QuestionDifficulty, number> = { EASY: 0.8, MEDIUM: 0.6, HARD: 0.4 };
export const BOT_P_MIN = 0.15;
export const BOT_P_MAX = 0.92;
/** Typical answer time as a share of the question's clock. */
export const BOT_MEDIAN_SHARE: Record<QuestionDifficulty, number> = { EASY: 0.22, MEDIUM: 0.34, HARD: 0.46 };
export const BOT_TIME_SIGMA = 0.4;
export const BOT_MIN_ANSWER_MS = 4_000;
/** The bot never answers inside this margin of the buzzer unless it runs out the clock. */
export const BOT_BUZZER_MARGIN_MS = 1_500;
export const BOT_TIMEOUT_P: Record<QuestionDifficulty, number> = { EASY: 0.01, MEDIUM: 0.02, HARD: 0.05 };
export const BOT_WRONG_SLOWDOWN = 1.15;
export const BOT_PAUSE_P = 0.1;
export const BOT_PAUSE_MS: readonly [number, number] = [2_000, 6_000];

// ---- Seeded randomness -----------------------------------------------------------

/** mulberry32: a tiny deterministic generator, uniform in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// ---- Profile ----------------------------------------------------------------------

/**
 * `expectedP` is the probability, from the student's own ability, that they
 * answer that question right (null when there is no ability yet).
 */
export function buildBotProfile(params: {
  seed: number;
  slots: { difficulty: QuestionDifficulty; expectedP: number | null }[];
  /** The human's first name, so the bot never shares it. */
  avoidName?: string;
}): BotProfile {
  const rand = seededRandom(params.seed);
  const avoid = params.avoidName?.trim().toLowerCase();
  const names = BOT_NAMES.filter((n) => n.toLowerCase() !== avoid);
  const name = names[Math.floor(rand() * names.length)];
  const avatar = Math.floor(rand() * BOT_AVATARS.length);
  const speed = clamp(Math.exp(0.2 * normal(rand)), 0.7, 1.4);
  const form = 0.06 * normal(rand); // a good or bad day, shared by the whole match
  const pCorrect = params.slots.map((s) => {
    const base = s.expectedP ?? BOT_DEFAULT_P[s.difficulty];
    return clamp(base + form + 0.04 * normal(rand), BOT_P_MIN, BOT_P_MAX);
  });
  return { v: 1, seed: params.seed, name, avatar, speed, difficulties: params.slots.map((s) => s.difficulty), pCorrect };
}

/** Reads a stored profile back, refusing anything malformed. */
export function parseBotProfile(raw: unknown): BotProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<BotProfile>;
  if (
    p.v !== 1 ||
    typeof p.seed !== "number" ||
    typeof p.name !== "string" ||
    typeof p.avatar !== "number" ||
    typeof p.speed !== "number" ||
    !Array.isArray(p.difficulties) ||
    !Array.isArray(p.pCorrect) ||
    p.difficulties.length !== p.pCorrect.length
  ) {
    return null;
  }
  return p as BotProfile;
}

// ---- The run ----------------------------------------------------------------------

/** What the bot does on one question: a pure function of the seed and position. */
export function botAnswer(profile: BotProfile, position: number, limitMs: number): { isCorrect: boolean; timedOut: boolean; elapsedMs: number } {
  const difficulty = profile.difficulties[position];
  const rand = seededRandom((profile.seed ^ Math.imul(position + 1, 0x9e3779b1)) >>> 0);
  const timeoutRoll = rand();
  const correctRoll = rand();
  const timeRoll = normal(rand);
  const pauseRoll = rand();
  const pauseLen = rand();

  if (timeoutRoll < BOT_TIMEOUT_P[difficulty]) return { isCorrect: false, timedOut: true, elapsedMs: limitMs };

  const isCorrect = correctRoll < profile.pCorrect[position];
  let ms = limitMs * BOT_MEDIAN_SHARE[difficulty] * profile.speed * Math.exp(BOT_TIME_SIGMA * timeRoll);
  if (!isCorrect) ms *= BOT_WRONG_SLOWDOWN;
  if (pauseRoll < BOT_PAUSE_P) ms += BOT_PAUSE_MS[0] + pauseLen * (BOT_PAUSE_MS[1] - BOT_PAUSE_MS[0]);
  const ceiling = Math.max(BOT_MIN_ANSWER_MS, limitMs - BOT_BUZZER_MARGIN_MS);
  return { isCorrect, timedOut: false, elapsedMs: Math.round(clamp(ms, BOT_MIN_ANSWER_MS, ceiling)) };
}

/** The whole run, scored by the challenge's own rules (streak bonus included). */
export function botRounds(profile: BotProfile, limitMs: number, scoringVersion: number): BotRound[] {
  const rounds: BotRound[] = [];
  let streak = 0;
  for (let position = 0; position < profile.difficulties.length; position++) {
    const a = botAnswer(profile, position, limitMs);
    const scored = scoreRushAnswerWithStreak({ isCorrect: a.isCorrect, elapsedMs: a.elapsedMs, limitMs, previousStreak: streak, version: scoringVersion });
    streak = scored.streak;
    rounds.push({ position, ...a, points: scored.points });
  }
  return rounds;
}

/**
 * Has the bot answered `position` yet? `elapsedMs` is how long that question
 * has been open; earlier positions are always done.
 */
export function botHasAnswered(rounds: BotRound[], position: number, openPosition: number, elapsedMs: number | null): boolean {
  if (position < openPosition) return true;
  if (position > openPosition || elapsedMs === null) return false;
  return rounds[position] !== undefined && rounds[position].elapsedMs <= elapsedMs;
}

/** The bot's score and correct count as the scoreboard shows them right now. */
export function botSnapshot(rounds: BotRound[], openPosition: number, elapsedMs: number | null): { score: number; correctCount: number } {
  let score = 0;
  let correctCount = 0;
  for (const r of rounds) {
    if (!botHasAnswered(rounds, r.position, openPosition, elapsedMs)) continue;
    score += r.points;
    if (r.isCorrect) correctCount++;
  }
  return { score, correctCount };
}

// ---- Matchmaking ---------------------------------------------------------------------

/**
 * What a lobby should do on this poll. A bot is only ever offered to a random
 * lobby the creator is alone in, never to a rematch room (it is addressed to
 * one named student), and only once the wait reaches RUSH_BOT_AFTER_MS. Until
 * then the lobby stays open for a real student; if one claims it first, the
 * room is already past WAITING and this answers WAIT.
 */
export function lobbyDecision(params: {
  mode: "FRIEND" | "RANDOM" | "SOLO";
  liveStatus: string | null;
  runCount: number;
  invited: boolean;
  waitedMs: number;
  botEnabled: boolean;
  afterMs?: number;
}): "WAIT" | "MATCH_BOT" {
  if (!params.botEnabled || params.mode !== "RANDOM" || params.liveStatus !== "WAITING") return "WAIT";
  if (params.runCount !== 1 || params.invited) return "WAIT";
  return params.waitedMs >= (params.afterMs ?? RUSH_BOT_AFTER_MS) ? "MATCH_BOT" : "WAIT";
}
