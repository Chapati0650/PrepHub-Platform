import type { QuestionCategory } from "@/generated/prisma/client";
import {
  ADDITIONAL_PRIORITY_ALLOCATED_QUESTIONS,
  ALL_CATEGORIES,
  GUARANTEED_QUESTIONS_PER_CATEGORY,
  MAX_QUESTIONS_PER_CATEGORY,
} from "./config";

const MAX_ADDITIONAL_PER_CATEGORY = MAX_QUESTIONS_PER_CATEGORY - GUARANTEED_QUESTIONS_PER_CATEGORY;

export type CategoryPriorityInput = { category: QuestionCategory; priority: number };
export type CategoryAllocation = { category: QuestionCategory; guaranteed: number; additional: number; total: number };

// PRD-014 §8 — largest-remainder proportional allocation of the 14 "additional"
// slots, with a per-category cap and iterative redistribution of any excess
// among the categories still under the cap. Ties in fractional remainder break
// by the fixed category order (PRD-014 §2 / CLAUDE.md's 7-category order).
function distributeAdditionalSlots(
  categories: CategoryPriorityInput[],
  slotsToDistribute: number,
): Map<QuestionCategory, number> {
  const result = new Map<QuestionCategory, number>();
  let remaining = categories;
  let slotsLeft = slotsToDistribute;

  while (remaining.length > 0 && slotsLeft > 0) {
    const totalPriority = remaining.reduce((sum, c) => sum + c.priority, 0);

    const ideals = remaining.map((c) => ({
      category: c.category,
      ideal: totalPriority === 0 ? slotsLeft / remaining.length : slotsLeft * (c.priority / totalPriority),
    }));

    const floors = ideals.map((a) => ({
      category: a.category,
      floor: Math.floor(a.ideal),
      remainder: a.ideal - Math.floor(a.ideal),
    }));
    const assignedByFloor = floors.reduce((sum, f) => sum + f.floor, 0);
    const leftoverSlots = slotsLeft - assignedByFloor;

    // Fixed-order index for deterministic tie-breaking on equal remainders.
    const sortedByRemainder = floors
      .map((f) => ({ ...f, orderIndex: ALL_CATEGORIES.indexOf(f.category) }))
      .sort((a, b) => b.remainder - a.remainder || a.orderIndex - b.orderIndex);

    const roundCounts = new Map<QuestionCategory, number>();
    for (const f of floors) roundCounts.set(f.category, f.floor);
    for (let i = 0; i < leftoverSlots; i++) {
      const target = sortedByRemainder[i];
      roundCounts.set(target.category, (roundCounts.get(target.category) ?? 0) + 1);
    }

    const overCapped: QuestionCategory[] = [];
    let excess = 0;
    for (const c of remaining) {
      const priorTotal = result.get(c.category) ?? 0;
      const roundTotal = roundCounts.get(c.category) ?? 0;
      const newTotal = priorTotal + roundTotal;
      if (newTotal > MAX_ADDITIONAL_PER_CATEGORY) {
        excess += newTotal - MAX_ADDITIONAL_PER_CATEGORY;
        result.set(c.category, MAX_ADDITIONAL_PER_CATEGORY);
        overCapped.push(c.category);
      } else {
        result.set(c.category, newTotal);
      }
    }

    remaining = remaining.filter((c) => !overCapped.includes(c.category));
    slotsLeft = overCapped.length > 0 ? excess : 0;
  }

  for (const c of categories) {
    if (!result.has(c.category)) result.set(c.category, 0);
  }
  return result;
}

export function allocateCategories(priorities: CategoryPriorityInput[]): CategoryAllocation[] {
  const additional = distributeAdditionalSlots(priorities, ADDITIONAL_PRIORITY_ALLOCATED_QUESTIONS);

  const allocations = ALL_CATEGORIES.map((category) => {
    const additionalCount = additional.get(category) ?? 0;
    return {
      category,
      guaranteed: GUARANTEED_QUESTIONS_PER_CATEGORY,
      additional: additionalCount,
      total: GUARANTEED_QUESTIONS_PER_CATEGORY + additionalCount,
    };
  });

  const totalQuestions = allocations.reduce((sum, a) => sum + a.total, 0);
  if (totalQuestions !== GUARANTEED_QUESTIONS_PER_CATEGORY * ALL_CATEGORIES.length + ADDITIONAL_PRIORITY_ALLOCATED_QUESTIONS) {
    throw new Error(`Category allocation invariant violated: totals to ${totalQuestions}, expected 21`);
  }
  if (allocations.some((a) => a.total > MAX_QUESTIONS_PER_CATEGORY)) {
    throw new Error("Category allocation invariant violated: a category exceeded the maximum");
  }

  return allocations;
}
