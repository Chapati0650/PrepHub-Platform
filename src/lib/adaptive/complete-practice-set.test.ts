import { beforeEach, describe, expect, it, vi } from "vitest";
import { completePracticeSet } from "@/lib/adaptive/complete-practice-set";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { abilitiesFromHistory } from "@/lib/adaptive/diagnostic-initialization";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    practiceSet: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    categoryState: { findUnique: vi.fn(), update: vi.fn() },
    blueprintSlot: { findUnique: vi.fn(), update: vi.fn() },
    finalizedAttempt: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    diagnosticAttempt: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  (mockPrisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation((arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: unknown) => unknown)(mockPrisma);
    return Promise.all(arg as Promise<unknown>[]);
  });
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as {
  practiceSet: Record<string, ReturnType<typeof vi.fn>>;
  categoryState: Record<string, ReturnType<typeof vi.fn>>;
  blueprintSlot: Record<string, ReturnType<typeof vi.fn>>;
  finalizedAttempt: Record<string, ReturnType<typeof vi.fn>>;
  diagnosticAttempt: Record<string, ReturnType<typeof vi.fn>>;
};

const at = new Date("2026-11-06T12:00:00Z");
// The student's history, as the completion's re-estimate reads it.
const DIAGNOSTIC = [
  { category: "ALGEBRA", difficulty: "EASY", isCorrect: true, submittedAt: at, waivedAt: null },
  { category: "ALGEBRA", difficulty: "MEDIUM", isCorrect: false, submittedAt: at, waivedAt: null },
  { category: "ALGEBRA", difficulty: "HARD", isCorrect: null, submittedAt: null, waivedAt: at },
  { category: "GRAMMAR", difficulty: "EASY", isCorrect: true, submittedAt: at, waivedAt: null },
];
const PRACTICE = [
  { category: "ALGEBRA", difficulty: "MEDIUM", isCorrect: true },
  { category: "GEOMETRY_TRIGONOMETRY", difficulty: "EASY", isCorrect: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  // This request wins the claim unless a test says otherwise.
  mocked.practiceSet.updateMany.mockResolvedValue({ count: 1 });
  mocked.practiceSet.findUniqueOrThrow.mockResolvedValue({ id: "set1", status: "COMPLETED", completedAt: new Date() });
  mocked.diagnosticAttempt.findMany.mockResolvedValue(DIAGNOSTIC);
  mocked.finalizedAttempt.findMany.mockResolvedValue(PRACTICE);
});

// One slot per category, all already finalized — the simplest "everyone
// answered, nothing blank" completion path.
function fullyAnsweredSet(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "set1",
    studentId: "student1",
    status: "ACTIVE",
    slots: ALL_CATEGORIES.map((category, i) => ({
      id: `slot${i}`,
      resolvedCategory: category,
      finalizedAttempt: { id: `fa${i}` } as { id: string } | null,
    })),
    ...overrides,
  };
}

describe("completePracticeSet", () => {
  it("is idempotent — returns the set unchanged if already completed", async () => {
    mocked.practiceSet.findUnique.mockResolvedValue({ ...fullyAnsweredSet(), status: "COMPLETED" });

    const result = await completePracticeSet("student1", "set1", { confirmBlanks: false });

    expect(result).toMatchObject({ status: "COMPLETED" });
    expect(mocked.categoryState.update).not.toHaveBeenCalled();
  });

  it("throws BLANKS_REMAIN when unanswered slots exist and blanks are not confirmed", async () => {
    const set = fullyAnsweredSet();
    set.slots[0] = { ...set.slots[0], finalizedAttempt: null };
    mocked.practiceSet.findUnique.mockResolvedValue(set);

    await expect(completePracticeSet("student1", "set1", { confirmBlanks: false })).rejects.toThrow(/unanswered/i);
  });

  it("finalizes remaining blanks as incorrect when confirmBlanks is true", async () => {
    const set = fullyAnsweredSet();
    set.slots[0] = { ...set.slots[0], finalizedAttempt: null };
    mocked.practiceSet.findUnique.mockResolvedValue(set);
    mocked.blueprintSlot.findUnique.mockResolvedValue({
      id: "slot0",
      practiceSetId: "set1",
      resolvedCategory: ALL_CATEGORIES[0],
      resolvedDifficulty: "MEDIUM",
      questionId: "q1",
      finalizedAttempt: null,
      practiceSet: { studentId: "student1" },
      question: { questionType: "MULTIPLE_CHOICE" },
      questionRevision: { answerChoices: [], acceptedAnswers: [] },
    });
    mocked.categoryState.findUnique.mockResolvedValue({ id: "cs1", ability: 50, adaptiveQuestionsAnswered: 0 });
    mocked.finalizedAttempt.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => data);

    await completePracticeSet("student1", "set1", { confirmBlanks: true });

    expect(mocked.finalizedAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isBlank: true, isCorrect: false }) }),
    );
  });

  it("increments consecutiveSetsWithoutExtraAllocation for a category with exactly one question", async () => {
    mocked.practiceSet.findUnique.mockResolvedValue(fullyAnsweredSet());

    await completePracticeSet("student1", "set1", { confirmBlanks: false });

    expect(mocked.categoryState.update).toHaveBeenCalledWith({
      where: { studentId_category: { studentId: "student1", category: ALL_CATEGORIES[0] } },
      data: expect.objectContaining({ consecutiveSetsWithoutExtraAllocation: { increment: 1 } }),
    });
  });

  it("re-estimates every category from the whole history, and the initial abilities from the Diagnostic alone", async () => {
    mocked.practiceSet.findUnique.mockResolvedValue(fullyAnsweredSet());

    await completePracticeSet("student1", "set1", { confirmBlanks: false });

    // The waived Hard question is no answer at all.
    const served = DIAGNOSTIC.filter((a) => a.waivedAt === null).map((a) => ({
      category: a.category,
      difficulty: a.difficulty,
      isCorrect: !!a.isCorrect,
    })) as Parameters<typeof abilitiesFromHistory>[0];
    const initial = abilitiesFromHistory(served);
    const current = abilitiesFromHistory(served, PRACTICE as Parameters<typeof abilitiesFromHistory>[0]);
    expect(mocked.categoryState.update).toHaveBeenCalledTimes(ALL_CATEGORIES.length);
    for (const category of ALL_CATEGORIES) {
      expect(mocked.categoryState.update).toHaveBeenCalledWith({
        where: { studentId_category: { studentId: "student1", category } },
        data: expect.objectContaining({ ability: current[category], initialAbility: initial[category] }),
      });
    }
    expect(mocked.diagnosticAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { diagnosticSession: { studentId: "student1" } } }),
    );
    expect(mocked.finalizedAttempt.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { studentId: "student1" } }));
  });

  it("resets consecutiveSetsWithoutExtraAllocation to 0 for a category with two or more questions", async () => {
    const set = fullyAnsweredSet();
    set.slots.push({ id: "slotExtra", resolvedCategory: ALL_CATEGORIES[0], finalizedAttempt: { id: "faExtra" } });
    mocked.practiceSet.findUnique.mockResolvedValue(set);

    await completePracticeSet("student1", "set1", { confirmBlanks: false });

    expect(mocked.categoryState.update).toHaveBeenCalledWith({
      where: { studentId_category: { studentId: "student1", category: ALL_CATEGORIES[0] } },
      data: expect.objectContaining({ consecutiveSetsWithoutExtraAllocation: 0 }),
    });
  });

  it("marks the set completed with a completedAt timestamp, claiming it only while still ACTIVE", async () => {
    mocked.practiceSet.findUnique.mockResolvedValue(fullyAnsweredSet());

    const result = await completePracticeSet("student1", "set1", { confirmBlanks: false });

    expect(mocked.practiceSet.updateMany).toHaveBeenCalledWith({
      where: { id: "set1", status: "ACTIVE" },
      data: expect.objectContaining({ status: "COMPLETED", completedAt: expect.any(Date) }),
    });
    expect(result).toMatchObject({ status: "COMPLETED" });
  });

  it("leaves the counters alone when a concurrent completion already claimed the set", async () => {
    // Both requests read ACTIVE before either committed; the second one's
    // conditional update matches nothing once the first has flipped the row.
    mocked.practiceSet.findUnique.mockResolvedValue(fullyAnsweredSet());
    mocked.practiceSet.updateMany.mockResolvedValue({ count: 0 });

    const result = await completePracticeSet("student1", "set1", { confirmBlanks: false });

    expect(mocked.categoryState.update).not.toHaveBeenCalled();
    expect(mocked.finalizedAttempt.findMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "COMPLETED" });
  });
});
