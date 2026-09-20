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

export const RUSH_DIFFICULTIES: Record<RushDifficulty, { label: string; pool: readonly QuestionDifficulty[] }> = {
  EASY: { label: "Easy", pool: ["EASY"] },
  MEDIUM: { label: "Medium", pool: ["MEDIUM"] },
  HARD: { label: "Hard", pool: ["HARD"] },
  MIXED: { label: "Mixed", pool: ["EASY", "MEDIUM", "HARD"] },
};
export const RUSH_DIFFICULTY_ORDER: readonly RushDifficulty[] = ["EASY", "MEDIUM", "HARD", "MIXED"];

export const RUSH_MODES: Record<RushMode, { label: string; blurb: string }> = {
  RANDOM: { label: "Random opponent", blurb: "Get matched with another PrepHub student on the same ten questions." },
  FRIEND: { label: "Challenge a friend", blurb: "Get a link and a code. Anyone with a PrepHub account can accept, free." },
  SOLO: { label: "Solo", blurb: "Race the clock on your own. Your best score is the one to beat." },
};
export const RUSH_MODE_ORDER: readonly RushMode[] = ["RANDOM", "FRIEND", "SOLO"];

export function isRushSection(value: unknown): value is ClubSection {
  return value === "READING_WRITING" || value === "MATH";
}
export function isRushDifficulty(value: unknown): value is RushDifficulty {
  return value === "EASY" || value === "MEDIUM" || value === "HARD" || value === "MIXED";
}
export function isRushMode(value: unknown): value is RushMode {
  return value === "SOLO" || value === "FRIEND" || value === "RANDOM";
}
