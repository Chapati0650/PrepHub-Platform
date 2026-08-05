import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { allocateCategories } from "./allocation";
import { ALL_CATEGORIES, ENGINE_VERSION, MAX_QUESTIONS_PER_CATEGORY, RECENT_PERFORMANCE_WINDOW } from "./config";
import { sampleDifficulty } from "./difficulty";
import { AdaptiveError } from "./errors";
import { focusRecencyScore, priorityScore, recentStruggleScore, weaknessScore } from "./priority";
import { generateSeed, createRandom, shuffle } from "./random";
import { selectQuestionForSlot, type SelectedQuestion } from "./question-selection";

type PlannedSlot = { plannedCategory: QuestionCategory; plannedDifficulty: QuestionDifficulty };
type ResolvedSlot = PlannedSlot & SelectedQuestion & { position: number };

async function loadRecentStruggleInputs(studentId: string, category: QuestionCategory) {
  const recent = await prisma.finalizedAttempt.findMany({
    where: { studentId, category },
    orderBy: { finalizedAt: "desc" },
    take: RECENT_PERFORMANCE_WINDOW,
    select: { expectedProbability: true, isCorrect: true },
  });
  return recent.map((r) => ({ expectedProbability: r.expectedProbability, isCorrect: r.isCorrect }));
}

// PRD-014 §15 — generates and persists a new 21-question Practice Set, or
// returns the student's existing Active Practice Set unchanged (an Active
// Practice Set is never regenerated). Nothing is written to the database
// until the full blueprint has been successfully resolved end to end.
export async function generatePracticeSet(studentId: string) {
  const existingActive = await prisma.practiceSet.findFirst({
    where: { studentId, status: "ACTIVE" },
    include: { slots: { orderBy: { position: "asc" } } },
  });
  if (existingActive) return existingActive;

  const categoryStates = await prisma.categoryState.findMany({ where: { studentId } });
  if (categoryStates.length !== ALL_CATEGORIES.length) {
    throw new AdaptiveError("GENERATION_FAILED", "Category states are missing — diagnostic must complete first.");
  }
  const stateByCategory = new Map(categoryStates.map((s) => [s.category, s]));
  const abilityByCategory = new Map(categoryStates.map((s) => [s.category, s.ability]));

  const snapshots = await Promise.all(
    ALL_CATEGORIES.map(async (category) => {
      const state = stateByCategory.get(category)!;
      const weakness = weaknessScore(state.ability);
      const recentInputs = await loadRecentStruggleInputs(studentId, category);
      const struggle = recentStruggleScore(recentInputs);
      const focus = focusRecencyScore(state.consecutiveSetsWithoutExtraAllocation);
      const priority = priorityScore(weakness, struggle, focus);
      return { category, ability: state.ability, weakness, struggle, focus, priority };
    }),
  );

  const allocations = allocateCategories(snapshots.map((s) => ({ category: s.category, priority: s.priority })));
  const allocationByCategory = new Map(allocations.map((a) => [a.category, a]));

  const randomSeed = generateSeed();
  const random = createRandom(randomSeed);

  const plannedSlots: PlannedSlot[] = [];
  for (const allocation of allocations) {
    const ability = abilityByCategory.get(allocation.category)!;
    for (let i = 0; i < allocation.total; i++) {
      const plannedDifficulty = sampleDifficulty(ability, random);
      plannedSlots.push({ plannedCategory: allocation.category, plannedDifficulty });
    }
  }
  shuffle(plannedSlots, random);

  const excludeQuestionIds = new Set<string>();
  const excludeFamilyIds = new Set<string>();
  const resolvedCounts = new Map<QuestionCategory, number>(allocations.map((a) => [a.category, a.total]));
  const priorityByCategory = new Map(snapshots.map((s) => [s.category, s.priority]));

  const resolvedSlots: ResolvedSlot[] = [];
  const failures: { plannedCategory: QuestionCategory; plannedDifficulty: QuestionDifficulty }[] = [];

  for (let position = 0; position < plannedSlots.length; position++) {
    const planned = plannedSlots[position];
    let selected = await selectQuestionForSlot({
      studentId,
      plannedCategory: planned.plannedCategory,
      plannedDifficulty: planned.plannedDifficulty,
      excludeQuestionIds,
      excludeFamilyIds,
      random,
    });

    if (!selected) {
      // PRD-014 §12.2 — category reallocation: try the highest-priority
      // categories (excluding the planned one) that are still below the cap.
      const candidateCategories = ALL_CATEGORIES.filter((c) => c !== planned.plannedCategory)
        .filter((c) => (resolvedCounts.get(c) ?? 0) < MAX_QUESTIONS_PER_CATEGORY)
        .sort((a, b) => (priorityByCategory.get(b) ?? 0) - (priorityByCategory.get(a) ?? 0));

      for (const fallbackCategory of candidateCategories) {
        const fallbackAbility = abilityByCategory.get(fallbackCategory)!;
        const fallbackDifficulty = sampleDifficulty(fallbackAbility, random);
        selected = await selectQuestionForSlot({
          studentId,
          plannedCategory: fallbackCategory,
          plannedDifficulty: fallbackDifficulty,
          excludeQuestionIds,
          excludeFamilyIds,
          random,
        });
        if (selected) break;
      }
    }

    if (!selected) {
      failures.push(planned);
      continue;
    }

    if (selected.category !== planned.plannedCategory) {
      resolvedCounts.set(planned.plannedCategory, (resolvedCounts.get(planned.plannedCategory) ?? 0) - 1);
      resolvedCounts.set(selected.category, (resolvedCounts.get(selected.category) ?? 0) + 1);
    }

    excludeQuestionIds.add(selected.questionId);
    if (selected.familyId) excludeFamilyIds.add(selected.familyId);
    resolvedSlots.push({ ...planned, ...selected, position });
  }

  if (failures.length > 0) {
    const pools = failures.map((f) => `${f.plannedCategory}/${f.plannedDifficulty}`).join(", ");
    throw new AdaptiveError("GENERATION_FAILED", `Unable to select questions for: ${pools}`);
  }

  const nextSetAggregate = await prisma.practiceSet.aggregate({ where: { studentId }, _max: { setNumber: true } });
  const setNumber = (nextSetAggregate._max.setNumber ?? 0) + 1;

  const practiceSet = await prisma.$transaction(async (tx) => {
    const created = await tx.practiceSet.create({
      data: {
        studentId,
        setNumber,
        status: "ACTIVE",
        engineVersion: ENGINE_VERSION,
        randomSeed,
        currentPosition: 0,
        categorySnapshots: {
          create: snapshots.map((s) => ({
            category: s.category,
            abilityAtGeneration: s.ability,
            weaknessScore: s.weakness,
            recentStruggleScore: s.struggle,
            focusRecencyScore: s.focus,
            priorityScore: s.priority,
            guaranteedSlotCount: allocationByCategory.get(s.category)!.guaranteed,
            additionalSlotCount: allocationByCategory.get(s.category)!.additional,
          })),
        },
        slots: {
          create: resolvedSlots.map((slot) => ({
            position: slot.position,
            plannedCategory: slot.plannedCategory,
            plannedDifficulty: slot.plannedDifficulty,
            resolvedCategory: slot.category,
            resolvedDifficulty: slot.difficulty,
            questionId: slot.questionId,
            questionRevisionId: slot.questionRevisionId,
            questionFamilyId: slot.familyId,
          })),
        },
      },
      include: { slots: { orderBy: { position: "asc" } } },
    });
    return created;
  });

  return practiceSet;
}
