import { beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeAnswer } from "@/lib/adaptive/finalize-answer";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    blueprintSlot: { findUnique: vi.fn(), update: vi.fn() },
    categoryState: { findUnique: vi.fn(), update: vi.fn() },
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
  blueprintSlot: Record<string, ReturnType<typeof vi.fn>>;
  categoryState: Record<string, ReturnType<typeof vi.fn>>;
  finalizedAttempt: Record<string, ReturnType<typeof vi.fn>>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

const baseSlot = {
  id: "slot1",
  practiceSetId: "set1",
  resolvedCategory: "ALGEBRA" as const,
  resolvedDifficulty: "MEDIUM" as const,
  questionId: "q1",
  finalizedAttempt: null,
  practiceSet: { studentId: "student1" },
  question: { questionType: "MULTIPLE_CHOICE" as const },
  questionRevision: {
    answerChoices: [
      { id: "c1", isCorrect: true },
      { id: "c2", isCorrect: false },
    ],
    acceptedAnswers: [],
  },
};

const baseCategoryState = {
  id: "cs1",
  ability: 50,
  adaptiveQuestionsAnswered: 0,
};

describe("finalizeAnswer", () => {
  it("returns the existing finalized attempt without re-applying the ability update (idempotent)", async () => {
    const existing = { id: "fa1", isCorrect: true };
    mocked.blueprintSlot.findUnique.mockResolvedValue({ ...baseSlot, finalizedAttempt: existing });

    const result = await finalizeAnswer({ studentId: "student1", blueprintSlotId: "slot1", answer: "c1", isBlank: false });

    expect(result).toBe(existing);
    expect(mocked.categoryState.update).not.toHaveBeenCalled();
  });

  it("grades a correct multiple-choice answer, updates ability upward, and stores calculation values", async () => {
    mocked.blueprintSlot.findUnique.mockResolvedValue(baseSlot);
    mocked.categoryState.findUnique.mockResolvedValue(baseCategoryState);
    mocked.finalizedAttempt.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => data);

    const result = await finalizeAnswer({ studentId: "student1", blueprintSlotId: "slot1", answer: "c1", isBlank: false });

    expect(result).toMatchObject({ isCorrect: true, isBlank: false, abilityBefore: 50 });
    expect((result as { abilityAfter: number }).abilityAfter).toBeGreaterThan(50);
    expect(mocked.categoryState.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ adaptiveQuestionsAnswered: { increment: 1 } }),
      }),
    );
  });

  it("treats a confirmed blank as incorrect and decreases ability", async () => {
    mocked.blueprintSlot.findUnique.mockResolvedValue(baseSlot);
    mocked.categoryState.findUnique.mockResolvedValue(baseCategoryState);
    mocked.finalizedAttempt.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => data);

    const result = await finalizeAnswer({ studentId: "student1", blueprintSlotId: "slot1", answer: null, isBlank: true });

    expect(result).toMatchObject({ isCorrect: false, isBlank: true, answer: null });
    expect((result as { abilityAfter: number }).abilityAfter).toBeLessThan(50);
  });

  it("grades an incorrect multiple-choice answer as incorrect", async () => {
    mocked.blueprintSlot.findUnique.mockResolvedValue(baseSlot);
    mocked.categoryState.findUnique.mockResolvedValue(baseCategoryState);
    mocked.finalizedAttempt.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => data);

    const result = await finalizeAnswer({ studentId: "student1", blueprintSlotId: "slot1", answer: "c2", isBlank: false });

    expect(result).toMatchObject({ isCorrect: false });
  });

  it("throws SLOT_NOT_FOUND when the slot belongs to a different student", async () => {
    mocked.blueprintSlot.findUnique.mockResolvedValue({ ...baseSlot, practiceSet: { studentId: "someone-else" } });

    await expect(finalizeAnswer({ studentId: "student1", blueprintSlotId: "slot1", answer: "c1", isBlank: false })).rejects.toThrow(
      /not found/i,
    );
  });

  it("recovers gracefully when a concurrent request already created the FinalizedAttempt (P2002 race)", async () => {
    mocked.blueprintSlot.findUnique.mockResolvedValue(baseSlot);
    mocked.categoryState.findUnique.mockResolvedValue(baseCategoryState);
    const conflictError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });
    mocked.finalizedAttempt.create.mockRejectedValue(conflictError);
    const raceWinner = { id: "fa-race", isCorrect: true };
    mocked.finalizedAttempt.findUnique.mockResolvedValue(raceWinner);

    const result = await finalizeAnswer({ studentId: "student1", blueprintSlotId: "slot1", answer: "c1", isBlank: false });

    expect(result).toBe(raceWinner);
  });
});
