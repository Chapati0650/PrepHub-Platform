import type { QuestionType } from "@/generated/prisma/client";

/**
 * What a class actually answered, question by question. Pure.
 *
 * "56% right" tells a teacher that a question went badly; "9 of 14 chose C"
 * tells them why — one wrong answer that most of the class picked is a
 * misconception to reteach, and wrong answers spread evenly are guessing.
 */

export type AssignedQuestionKey = {
  questionType: QuestionType;
  /** Multiple choice, in the order students see them. */
  choices: { id: string; isCorrect: boolean }[];
  /** Grid-in. */
  acceptedAnswers: string[];
};

export type GivenAnswer = { answer: string | null; isCorrect: boolean | null };

export type ChoiceCount = { label: string; count: number; correct: boolean };

export type AnswerBreakdown =
  | { kind: "choices"; choices: ChoiceCount[]; answered: number; commonWrong: string | null }
  | {
      kind: "entries";
      correctAnswer: string;
      correctCount: number;
      /** The wrong entries students gave most, most common first. */
      wrong: { value: string; count: number }[];
      answered: number;
    };

const LETTERS = ["A", "B", "C", "D", "E", "F"];
/** How many distinct wrong grid-in entries the results page lists. */
const WRONG_ENTRIES_SHOWN = 3;

/** "B" for a multiple-choice answer, the entry itself for a grid-in; "" if it can't be read. */
export function answerLabel(key: AssignedQuestionKey, answer: string | null): string {
  if (answer === null) return "";
  if (key.questionType !== "MULTIPLE_CHOICE") return answer.trim();
  const index = key.choices.findIndex((c) => c.id === answer);
  return index >= 0 ? (LETTERS[index] ?? "") : "";
}

/** The right answer, the way a teacher would say it out loud. */
export function correctLabel(key: AssignedQuestionKey): string {
  if (key.questionType !== "MULTIPLE_CHOICE") return key.acceptedAnswers[0] ?? "";
  const index = key.choices.findIndex((c) => c.isCorrect);
  return index >= 0 ? (LETTERS[index] ?? "") : "";
}

export function answerBreakdown(key: AssignedQuestionKey, given: GivenAnswer[]): AnswerBreakdown {
  const answered = given.filter((g) => g.answer !== null);

  if (key.questionType === "MULTIPLE_CHOICE") {
    const choices: ChoiceCount[] = key.choices.map((c, i) => ({
      label: LETTERS[i] ?? String(i + 1),
      count: answered.filter((g) => g.answer === c.id).length,
      correct: c.isCorrect,
    }));
    // A wrong answer only counts as "common" when more than one student
    // chose it and nothing wrong tied with it: one pick is noise, and a tie
    // isn't a pattern.
    const wrong = choices.filter((c) => !c.correct && c.count > 0).sort((a, b) => b.count - a.count);
    const commonWrong = wrong[0] && wrong[0].count >= 2 && wrong[0].count !== wrong[1]?.count ? wrong[0].label : null;
    return { kind: "choices", choices, answered: answered.length, commonWrong };
  }

  const counts = new Map<string, { value: string; count: number }>();
  let correctCount = 0;
  for (const g of answered) {
    if (g.isCorrect) {
      correctCount++;
      continue;
    }
    const value = (g.answer ?? "").trim();
    const normalized = value.toLowerCase();
    const entry = counts.get(normalized) ?? { value, count: 0 };
    entry.count++;
    counts.set(normalized, entry);
  }
  const wrong = [...counts.values()]
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, WRONG_ENTRIES_SHOWN);
  return { kind: "entries", correctAnswer: correctLabel(key), correctCount, wrong, answered: answered.length };
}

/**
 * The questions to go over in class: the lowest share right, at most two,
 * only below 70% right, and only once enough of the class has answered for
 * the share to mean something.
 */
export function mostMissedPositions(
  stats: { position: number; answered: number; correct: number }[],
  minAnswered = 3,
): Set<number> {
  const ranked = stats
    .filter((s) => s.answered >= minAnswered)
    .map((s) => ({ position: s.position, share: s.correct / s.answered }))
    .filter((s) => s.share < 0.7)
    .sort((a, b) => a.share - b.share || a.position - b.position);
  if (ranked.length <= 2) return new Set(ranked.map((s) => s.position));
  // The two lowest, and any tied with the second (review, 2026-11-09: Q8 and Q10 at 47% went unflagged
  // beside a flagged Q4 at 47%).
  const cutoff = ranked[1].share;
  return new Set(ranked.filter((s, i) => i < 2 || s.share === cutoff).map((s) => s.position));
}
