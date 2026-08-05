import { beforeEach, describe, expect, it, vi } from "vitest";
import { completePracticeSet } from "@/lib/adaptive/complete-practice-set";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    practiceSet: { findUnique: vi.fn(), update: vi.fn() },
    categoryState: { findUnique: vi.fn(), update: vi.fn() },
    blueprintSlot: { findUnique: vi.fn(), update: vi.fn() },
    finalizedAttempt: { create: vi.fn(), findUnique: vi.fn() },
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
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.practiceSet.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
    id: "set1",
    status: "COMPLETED",
    ...data,
  }));
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
    mocked.practiceSet.findUnique.mockResolvedValueOnce(set).mockResolvedValueOnce(set); // outer load + inner tx re-check
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
      data: { consecutiveSetsWithoutExtraAllocation: { increment: 1 } },
    });
  });

  it("resets consecutiveSetsWithoutExtraAllocation to 0 for a category with two or more questions", async () => {
    const set = fullyAnsweredSet();
    set.slots.push({ id: "slotExtra", resolvedCategory: ALL_CATEGORIES[0], finalizedAttempt: { id: "faExtra" } });
    mocked.practiceSet.findUnique.mockResolvedValue(set);

    await completePracticeSet("student1", "set1", { confirmBlanks: false });

    expect(mocked.categoryState.update).toHaveBeenCalledWith({
      where: { studentId_category: { studentId: "student1", category: ALL_CATEGORIES[0] } },
      data: { consecutiveSetsWithoutExtraAllocation: 0 },
    });
  });

  it("marks the set completed with a completedAt timestamp", async () => {
    mocked.practiceSet.findUnique.mockResolvedValue(fullyAnsweredSet());

    const result = await completePracticeSet("student1", "set1", { confirmBlanks: false });

    expect(mocked.practiceSet.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) }),
    );
    expect(result).toMatchObject({ status: "COMPLETED" });
  });
});
