import type { ExtraTime, QuestionCategory } from "@/generated/prisma/client";
import { MATH_WEIGHTS, READING_WRITING_WEIGHTS } from "@/lib/score/config";

/**
 * Every number a Guided Session runs on, in one place (CLAUDE.md: config that
 * changes behaviour is centralized). Where a number comes from research, the
 * source is beside it; the design and its reasons are in the proposal written
 * for Houston ISD's CCMR team (2026-11-04).
 */

/**
 * The class's skill is suggested only when this many students in it have
 * taken the Diagnostic. Fewer is too small a sample to trust, and the reason
 * given ("19 of 28 are below the line") would start to describe individuals.
 * The same floor the admin Overview uses for score figures.
 */
export const MIN_STUDENTS_FOR_PICK = 10;

/** A skill the class worked on in its last session counts this much, so sessions don't repeat. */
export const RECENT_SKILL_FACTOR = 0.5;

/**
 * After a class question's first vote (Crouch & Mazur 2001): above 70% right,
 * discussion adds little; 35–70% is where partner talk helps most; below 35%,
 * too few students know the idea for partners to help each other.
 */
export const MOVE_ON_ABOVE = 0.7;
export const TALK_FROM = 0.35;

/** Seconds to think alone: the digital SAT's own pace per question. */
export const THINK_SECONDS = { MATH: 95, READING_WRITING: 70 } as const;
export const TALK_SECONDS = 90;
/** The second vote is quick: students already know the question. */
export const REVOTE_SECONDS = 45;
/** "More time" adds this much to whatever clock is running. */
export const ADD_TIME_SECONDS = 30;

/** Session lengths a teacher can choose. */
export const SESSION_LENGTHS = {
  SHORT: { minutes: 25, classQuestions: 2, ownQuestions: 3, ownSeconds: 300 },
  STANDARD: { minutes: 30, classQuestions: 3, ownQuestions: 4, ownSeconds: 420 },
  LONG: { minutes: 45, classQuestions: 4, ownQuestions: 6, ownSeconds: 600 },
} as const;
export type SessionLength = keyof typeof SESSION_LENGTHS;

/** The College Board's two extended-time accommodations, as clock multipliers. */
export const EXTRA_TIME_FACTOR: Record<ExtraTime, number> = { NONE: 1, TIME_AND_HALF: 1.5, DOUBLE: 2 };
export const EXTRA_TIME_LABELS: Record<ExtraTime, string> = {
  NONE: "None",
  TIME_AND_HALF: "Time and a half",
  DOUBLE: "Double time",
};

/** An answer given this soon after a question opens is marked "very fast" for the teacher. */
export const VERY_FAST_MS = 5_000;
/** A student whose screen hasn't checked in for this long shows as "Away". */
export const AWAY_AFTER_MS = 25_000;
/** How often a student's screen checks in (it also does so when hidden/shown). */
export const HEARTBEAT_MS = 10_000;

/** Screens poll the shared state this often. */
export const STATE_POLL_MS = 1_500;
export const CONSOLE_POLL_MS = 2_000;

/**
 * Warm-ups come from a skill the class worked on this long ago: the spacing
 * that holds material until a test months away (Cepeda et al. 2008).
 */
export const WARMUP_MIN_DAYS = 7;
export const WARMUP_MAX_DAYS = 21;

/** Absent and late students can catch up on a session for this long. */
export const CATCH_UP_DAYS = 14;

export const MATH_CATEGORIES: QuestionCategory[] = [
  "ALGEBRA",
  "ADVANCED_MATH",
  "PROBLEM_SOLVING_DATA_ANALYSIS",
  "GEOMETRY_TRIGONOMETRY",
];

export type Section = "MATH" | "READING_WRITING";

export function sectionOf(category: QuestionCategory): Section {
  return MATH_CATEGORIES.includes(category) ? "MATH" : "READING_WRITING";
}

/**
 * How much a skill counts toward its section score: the same weights as the
 * predicted score (lib/score/config.ts), which follow how many SAT questions
 * test each skill.
 */
export const SKILL_WEIGHTS: Record<QuestionCategory, number> = {
  READING_COMPREHENSION: READING_WRITING_WEIGHTS.readingComprehension,
  GRAMMAR: READING_WRITING_WEIGHTS.grammar,
  VOCABULARY: READING_WRITING_WEIGHTS.vocabulary,
  ALGEBRA: MATH_WEIGHTS.algebra,
  ADVANCED_MATH: MATH_WEIGHTS.advancedMath,
  PROBLEM_SOLVING_DATA_ANALYSIS: MATH_WEIGHTS.problemSolving,
  GEOMETRY_TRIGONOMETRY: MATH_WEIGHTS.geometryTrigonometry,
};
