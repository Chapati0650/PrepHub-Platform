import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { sectionOf } from "./config";
import { SKILL_LINES } from "./pick-skill";
import { chooseQuestion, ownDifficulties, type Candidate } from "./select";

/**
 * Choosing an individual-practice run. Pure (no database), so the rules are
 * tested directly; `practice.ts` deals the result to students.
 */

/**
 * A student's weakest skills first: how far each sits below the college-ready
 * line for its section (the line the class skill pick uses). A skill they have
 * never been measured on counts as exactly on the line, so it comes after the
 * ones they are known to be weak in and before the ones they are strong in.
 * Only skills in `available` (those with questions) are considered.
 */
export function weakestCategories(
  levels: Partial<Record<QuestionCategory, number>>,
  available: readonly QuestionCategory[],
  count: number,
): QuestionCategory[] {
  const gap = (c: QuestionCategory) => (levels[c] === undefined ? 0 : levels[c]! - SKILL_LINES[sectionOf(c)]);
  return available
    .map((category, index) => ({ category, index, gap: gap(category) }))
    .sort((a, b) => a.gap - b.gap || a.index - b.index)
    .slice(0, Math.max(count, 0))
    .map((x) => x.category);
}

/** `count` slots dealt around the skills in turn, weakest first: 10 over 3 gives 4, 3, 3, interleaved. */
export function allocateSkills(count: number, categories: readonly QuestionCategory[]): QuestionCategory[] {
  if (categories.length === 0) return [];
  return Array.from({ length: count }, (_, i) => categories[i % categories.length]);
}

export type PlannedPracticeSlot = { category: QuestionCategory; candidate: Candidate };

/**
 * One student's run. For each slot: a difficulty at the student's level in
 * that skill (Medium with no Diagnostic), then a question they haven't seen
 * (fewest eyes first), never one already used. A skill that runs out of
 * questions hands its slot to the next skill in the list; the run is shorter
 * only when every skill is empty.
 */
export function planPracticeRun(params: {
  categories: readonly QuestionCategory[];
  count: number;
  abilityOf: (category: QuestionCategory) => number | null;
  candidates: ReadonlyMap<QuestionCategory, readonly Candidate[]>;
  seenBy: ReadonlyMap<string, number>;
  used: Set<string>;
  random: () => number;
}): PlannedPracticeSlot[] {
  const { categories, count, abilityOf, candidates, seenBy, used, random } = params;
  const out: PlannedPracticeSlot[] = [];
  for (const wanted of allocateSkills(count, categories)) {
    const order = [wanted, ...categories.filter((c) => c !== wanted)];
    for (const category of order) {
      const difficulty: QuestionDifficulty = ownDifficulties(category, abilityOf(category), 1, random)[0];
      const pick = chooseQuestion({ candidates: candidates.get(category) ?? [], difficulty, used, seenBy, random });
      if (!pick) continue;
      used.add(pick.questionId);
      out.push({ category, candidate: pick });
      break;
    }
  }
  return out;
}
