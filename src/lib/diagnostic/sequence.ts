import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";

/**
 * The order the Diagnostic is served in, and the rule for its bonus round.
 *
 * Why this file exists (2026-10-24). Production had 144 students start the
 * Diagnostic and 73 quit — and 48 of those 73 quit within the first three
 * questions. After question four almost nobody left: eighteen more questions,
 * including six Hard ones, lost 25 students between them. The opening was the
 * whole problem, and the opening was an accident. `start-diagnostic.ts` built
 * the 21 slots with a category-then-difficulty loop and then called
 * `shuffle(resolved, random)` — but `shuffle` returns a new array rather than
 * shuffling in place, and the result was discarded. So from the initial
 * commit onward every student met Reading Comprehension Easy, Medium, then
 * Hard: the three longest questions in the test, back to back, the third one
 * answered correctly 45% of the time, as their first impression of PrepHub.
 *
 * The replacement is designed rather than shuffled, because the data says the
 * opening is what matters and a random draw can put a Hard reading passage
 * first. Two parts:
 *
 * **Core — fourteen questions, one Easy and one Medium per category.** The
 * first four are the four likeliest wins, chosen from production accuracy and
 * length (Advanced Math Easy: 86% right, ~103 characters to read — the
 * shortest question in the test). Reading passages are never adjacent. Each
 * category's Easy comes before its Medium, and the two least-answered Mediums
 * come last, when almost nobody quits.
 *
 * **Bonus round — the Hard question, only where it was earned.** A category's
 * Hard question is served only if the student got that category's Medium
 * right; otherwise it is waived and scores as a wrong answer. Replaying all 71
 * real completed Diagnostics through this rule: students predicted below 1100
 * see about 17 questions and 3 Hard ones instead of 21 and 7, strong students
 * still see about 20 and keep a precise score, and the starting score lands in
 * the same displayed range two-thirds of the time while averaging ~29 points
 * lower than the full test (part of that gap is the full test crediting lucky
 * guesses on Hard questions). Dropping the Hard tier outright was rejected:
 * it scored every student ~112 points low, which a district's gain report
 * would then have counted as improvement that never happened.
 *
 * A waived Hard scores exactly as a wrong answer, so answering an unlocked one
 * can only raise a student's score — which is what lets the bonus round be
 * framed honestly as a reward rather than a test.
 */

export type SequenceSlot = { category: QuestionCategory; difficulty: QuestionDifficulty };

export const CORE_SEQUENCE: readonly SequenceSlot[] = [
  // Four likeliest wins first. Accuracy is production's, 2026-10-24.
  { category: "ADVANCED_MATH", difficulty: "EASY" }, // 86%, shortest in the test
  { category: "VOCABULARY", difficulty: "EASY" }, // 92%
  { category: "ALGEBRA", difficulty: "EASY" }, // 77%, short
  { category: "GRAMMAR", difficulty: "EASY" }, // 87%
  { category: "ALGEBRA", difficulty: "MEDIUM" }, // 68%, the shortest Medium
  { category: "READING_COMPREHENSION", difficulty: "EASY" }, // first passage, at Q6 rather than Q1
  { category: "VOCABULARY", difficulty: "MEDIUM" }, // 72%
  { category: "PROBLEM_SOLVING_DATA_ANALYSIS", difficulty: "EASY" }, // 69%
  { category: "GRAMMAR", difficulty: "MEDIUM" }, // 65%
  { category: "GEOMETRY_TRIGONOMETRY", difficulty: "EASY" }, // 64%
  { category: "READING_COMPREHENSION", difficulty: "MEDIUM" }, // second passage, five questions after the first
  // The two least-answered Mediums, where nobody in production quit.
  { category: "GEOMETRY_TRIGONOMETRY", difficulty: "MEDIUM" }, // 37%
  { category: "ADVANCED_MATH", difficulty: "MEDIUM" }, // 41%
  { category: "PROBLEM_SOLVING_DATA_ANALYSIS", difficulty: "MEDIUM" }, // 54%, so the core doesn't end on its hardest
];

/**
 * Most-answered first, so the first bonus question a student meets is the
 * likeliest win, alternating sections where it can, with the long Reading
 * passage away from the front. Only unlocked ones are ever shown.
 */
export const BONUS_SEQUENCE: readonly SequenceSlot[] = [
  { category: "GRAMMAR", difficulty: "HARD" }, // 56%
  { category: "PROBLEM_SOLVING_DATA_ANALYSIS", difficulty: "HARD" }, // 43%
  { category: "VOCABULARY", difficulty: "HARD" }, // 43%
  { category: "ALGEBRA", difficulty: "HARD" }, // 39%
  { category: "READING_COMPREHENSION", difficulty: "HARD" }, // 45%, but the longest question in the test
  { category: "ADVANCED_MATH", difficulty: "HARD" }, // 32%
  { category: "GEOMETRY_TRIGONOMETRY", difficulty: "HARD" }, // 22%
];

export const DIAGNOSTIC_SEQUENCE: readonly SequenceSlot[] = [...CORE_SEQUENCE, ...BONUS_SEQUENCE];

export const CORE_QUESTION_COUNT = CORE_SEQUENCE.length;
export const MAX_BONUS_QUESTIONS = BONUS_SEQUENCE.length;

/** Bonus-round membership is by difficulty, never by position, so a content
 * gap that drops a slot (see start-diagnostic.ts) can't shift a Hard question
 * into the core or a core question into the bonus round. */
export function isBonusDifficulty(difficulty: QuestionDifficulty): boolean {
  return difficulty === "HARD";
}

/** Where a (category, difficulty) belongs in the served order. */
export function sequenceIndex(category: QuestionCategory, difficulty: QuestionDifficulty): number {
  return DIAGNOSTIC_SEQUENCE.findIndex((s) => s.category === category && s.difficulty === difficulty);
}

/** The fields the stage rules read. Kept structural so tests need no Prisma. */
export type StageAttempt = {
  id: string;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  submittedAt: Date | null;
  isCorrect: boolean | null;
  waivedAt: Date | null;
};

/** Has this attempt's category earned its Hard question? */
function mediumWasRight(attempts: readonly StageAttempt[], category: QuestionCategory): boolean {
  const medium = attempts.find((a) => a.category === category && a.difficulty === "MEDIUM");
  return Boolean(medium?.submittedAt && medium.isCorrect);
}

export function coreAttempts<T extends StageAttempt>(attempts: readonly T[]): T[] {
  return attempts.filter((a) => !isBonusDifficulty(a.difficulty));
}

/**
 * Hard questions still to be answered: not answered, not waived, and earned.
 *
 * "Earned" is evaluated live rather than read from `waivedAt`, so this is right
 * even before the waiving step has run — for instance in the moment between
 * a student answering their last core question and the page settling the
 * bonus round.
 */
export function pendingBonusAttempts<T extends StageAttempt>(attempts: readonly T[]): T[] {
  return attempts.filter(
    (a) =>
      isBonusDifficulty(a.difficulty) &&
      a.submittedAt === null &&
      a.waivedAt === null &&
      mediumWasRight(attempts, a.category),
  );
}

/**
 * Which Hard questions to waive once the core is finished: unanswered, not
 * already waived, and in a category whose Medium was missed — or never
 * existed, when a content gap left the category without one.
 *
 * Returns nothing while the core is unfinished. A Medium the student skipped
 * and will come back to hasn't been missed yet, and waiving early would throw
 * away a Hard question they might still earn.
 *
 * A Hard question that was already answered is never waived. That only
 * happens to a session that began under the old fixed order, where the Hard
 * came third; its answer stands and counts like any other.
 */
export function attemptsToWaive<T extends StageAttempt>(attempts: readonly T[]): T[] {
  if (coreAttempts(attempts).some((a) => a.submittedAt === null)) return [];
  return attempts.filter(
    (a) =>
      isBonusDifficulty(a.difficulty) &&
      a.submittedAt === null &&
      a.waivedAt === null &&
      !mediumWasRight(attempts, a.category),
  );
}

export type DiagnosticStage = "CORE" | "BONUS" | "DONE";

export function diagnosticStage(attempts: readonly StageAttempt[]): DiagnosticStage {
  if (coreAttempts(attempts).some((a) => a.submittedAt === null)) return "CORE";
  if (pendingBonusAttempts(attempts).length > 0) return "BONUS";
  return "DONE";
}

/**
 * Every attempt that still needs an answer before the Diagnostic can complete.
 * The single definition both the completion check and the runner's "N left"
 * count use, so the two can't disagree about whether a waived question counts.
 */
export function unansweredAttempts<T extends StageAttempt>(attempts: readonly T[]): T[] {
  return attempts.filter((a) => a.submittedAt === null && a.waivedAt === null);
}
