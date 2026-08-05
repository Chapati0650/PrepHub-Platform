import { beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeDiagnosticAttempt } from "@/lib/diagnostic/finalize-attempt";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    diagnosticAttempt: { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  };
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as { diagnosticAttempt: Record<string, ReturnType<typeof vi.fn>> };

const baseAttempt = {
  id: "attempt1",
  submittedAt: null,
  diagnosticSession: { studentId: "student1", status: "IN_PROGRESS" },
  question: { questionType: "MULTIPLE_CHOICE" as const },
  questionRevision: {
    answerChoices: [
      { id: "c1", isCorrect: true },
      { id: "c2", isCorrect: false },
    ],
    acceptedAnswers: [],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.diagnosticAttempt.updateMany.mockResolvedValue({ count: 1 });
});

describe("finalizeDiagnosticAttempt", () => {
  it("throws ANSWER_REQUIRED for an empty or missing answer", async () => {
    await expect(finalizeDiagnosticAttempt("student1", "attempt1", "")).rejects.toThrow(/answer/i);
    await expect(finalizeDiagnosticAttempt("student1", "attempt1", "   ")).rejects.toThrow(/answer/i);
    expect(mocked.diagnosticAttempt.findUnique).not.toHaveBeenCalled();
  });

  it("throws ATTEMPT_NOT_FOUND when the attempt belongs to a different student", async () => {
    mocked.diagnosticAttempt.findUnique.mockResolvedValue({
      ...baseAttempt,
      diagnosticSession: { studentId: "someone-else", status: "IN_PROGRESS" },
    });

    await expect(finalizeDiagnosticAttempt("student1", "attempt1", "c1")).rejects.toThrow(/not found/i);
  });

  it("throws ALREADY_COMPLETED when the diagnostic session is already completed", async () => {
    mocked.diagnosticAttempt.findUnique.mockResolvedValue({
      ...baseAttempt,
      diagnosticSession: { studentId: "student1", status: "COMPLETED" },
    });

    await expect(finalizeDiagnosticAttempt("student1", "attempt1", "c1")).rejects.toThrow(/completed/i);
  });

  it("is idempotent — returns the already-submitted attempt without re-grading", async () => {
    const submitted = { ...baseAttempt, submittedAt: new Date(), isCorrect: true };
    mocked.diagnosticAttempt.findUnique.mockResolvedValue(submitted);

    const result = await finalizeDiagnosticAttempt("student1", "attempt1", "c2");

    expect(result).toBe(submitted);
    expect(mocked.diagnosticAttempt.updateMany).not.toHaveBeenCalled();
  });

  it("grades a correct multiple-choice answer and marks it submitted", async () => {
    mocked.diagnosticAttempt.findUnique.mockResolvedValue(baseAttempt);
    mocked.diagnosticAttempt.findUniqueOrThrow.mockResolvedValue({ id: "attempt1", isCorrect: true, submittedAt: new Date() });

    await finalizeDiagnosticAttempt("student1", "attempt1", "c1");

    expect(mocked.diagnosticAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "attempt1", submittedAt: null },
        data: expect.objectContaining({ isCorrect: true, isBlank: false, answer: "c1" }),
      }),
    );
  });

  it("grades an incorrect multiple-choice answer", async () => {
    mocked.diagnosticAttempt.findUnique.mockResolvedValue(baseAttempt);
    mocked.diagnosticAttempt.findUniqueOrThrow.mockResolvedValue({ id: "attempt1", isCorrect: false, submittedAt: new Date() });

    await finalizeDiagnosticAttempt("student1", "attempt1", "c2");

    expect(mocked.diagnosticAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isCorrect: false }) }),
    );
  });
});
