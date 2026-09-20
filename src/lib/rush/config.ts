import type { ClubSection, QuestionDifficulty, RushDifficulty, RushMode } from "@/generated/prisma/client";
import { CLUB_SECTIONS } from "@/lib/club/config";

// 1v1 Rush — the reference's "Question Rush": ten questions against the
// clock, solo or head-to-head. The Owner's three decisions (2026-09-20):
// challenges are asynchronous (the two players never need to be online
// together); an opponent is either a random match or a friend reached by
// link or code; and accepting a challenge is the free hook — anyone with an
// account can play a rush a friend sends them, while starting one is
// Premium.
//
// Like the 800 Club, a rush never touches the adaptive engine: an answer
// given under a 60-second clock says nothing reliable about ability, so it
// must never move a Category State or the Predicted Score.

export const RUSH_RUN_SIZE = 10;

// Per-question hard limit. Slightly under the real test's pace (~71s per
// Reading & Writing question, ~95s per Math question) so a rush is faster
// than a section, but not so tight that a long passage is unreadable.
export const RUSH_TIME_LIMIT_MS: Record<ClubSection, number> = {
  READING_WRITING: 60_000,
  MATH: 90_000,
};

// Network slack on top of the limit. The client auto-submits blank at 0, so
// a real answer that arrives a second late was sent in time and shouldn't
// score zero for the round trip.
export const RUSH_GRACE_MS = 2_000;

// A correct answer is worth RUSH_BASE_POINTS plus up to RUSH_SPEED_POINTS,
// scaled by the fraction of the clock left. A wrong or blank answer is 0 —
// no negative points, so guessing at the buzzer is never worse than
// running out the clock.
export const RUSH_BASE_POINTS = 100;
export const RUSH_SPEED_POINTS = 100;
export const RUSH_MAX_SCORE = RUSH_RUN_SIZE * (RUSH_BASE_POINTS + RUSH_SPEED_POINTS);

export const RUSH_SECTIONS = CLUB_SECTIONS;
export const RUSH_SECTION_ORDER: readonly ClubSection[] = ["READING_WRITING", "MATH"];

// Every rush is MIXED — dealt round-robin across easy/medium/hard (Owner
// decision, 2026-09-20: no difficulty picker). The enum stays on the row so
// the selector's per-tier logic and any old rows keep working, but nothing
// in the product offers the other three.
export const RUSH_DIFFICULTY: RushDifficulty = "MIXED";
export const RUSH_DIFFICULTIES: Record<RushDifficulty, { label: string; pool: readonly QuestionDifficulty[] }> = {
  EASY: { label: "Easy", pool: ["EASY"] },
  MEDIUM: { label: "Medium", pool: ["MEDIUM"] },
  HARD: { label: "Hard", pool: ["HARD"] },
  MIXED: { label: "Mixed", pool: ["EASY", "MEDIUM", "HARD"] },
};

// Live rooms (Owner decision, 2026-09-20: both players online at once).
// The countdown once both are in; the pause between questions where the
// ✓/✗ shows; how long since a player's last poll before they read as
// gone; how stale a lobby can be before the random queue skips it; and how
// long a random lobby waits before offering a recorded opponent instead.
export const LIVE_COUNTDOWN_MS = 5_000;
export const LIVE_GAP_MS = 2_500;
export const LIVE_PRESENCE_MS = 12_000;
export const LIVE_LOBBY_STALE_MS = 25_000;
export const LIVE_RANDOM_FALLBACK_MS = 30_000;
export const LIVE_POLL_MS = 1_000;
export const LIVE_LOBBY_POLL_MS = 1_500;

// What the hub offers. `live` and `mode` together pick the code path:
// RANDOM live = the lobby queue, FRIEND live = a room with a link, FRIEND
// async = play now and send it, SOLO = alone.
export type RushPlayOption = "RANDOM_LIVE" | "FRIEND_LIVE" | "FRIEND_ASYNC" | "SOLO";
export const RUSH_PLAY_OPTIONS: Record<RushPlayOption, { label: string; blurb: string; mode: RushMode; live: boolean }> = {
  RANDOM_LIVE: {
    label: "Random opponent",
    blurb: "Matched live with another student who's online right now — same questions, same clock.",
    mode: "RANDOM",
    live: true,
  },
  FRIEND_LIVE: {
    label: "Friend · live",
    blurb: "You wait in a room with a link and a code. They join, a countdown runs, and you start together.",
    mode: "FRIEND",
    live: true,
  },
  FRIEND_ASYNC: {
    label: "Friend · anytime",
    blurb: "Play now and send the link. They race your times whenever they get to it — no Premium needed on their side.",
    mode: "FRIEND",
    live: false,
  },
  SOLO: { label: "Solo", blurb: "Race the clock on your own. Your best score is the one to beat.", mode: "SOLO", live: false },
};
export const RUSH_PLAY_OPTION_ORDER: readonly RushPlayOption[] = ["RANDOM_LIVE", "FRIEND_LIVE", "FRIEND_ASYNC", "SOLO"];
export function isRushPlayOption(value: unknown): value is RushPlayOption {
  return value === "RANDOM_LIVE" || value === "FRIEND_LIVE" || value === "FRIEND_ASYNC" || value === "SOLO";
}

export const RUSH_MODES: Record<RushMode, { label: string }> = {
  RANDOM: { label: "Random opponent" },
  FRIEND: { label: "Friend challenge" },
  SOLO: { label: "Solo" },
};

export function isRushSection(value: unknown): value is ClubSection {
  return value === "READING_WRITING" || value === "MATH";
}
export function isRushMode(value: unknown): value is RushMode {
  return value === "SOLO" || value === "FRIEND" || value === "RANDOM";
}
