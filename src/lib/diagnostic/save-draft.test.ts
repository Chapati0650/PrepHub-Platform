import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveDiagnosticDraft, saveDiagnosticPosition } from "@/lib/diagnostic/save-draft";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    diagnosticAttempt: { findUnique: vi.fn(), update: vi.fn() },
    diagnosticSession: { findUnique: vi.fn(), update: vi.fn() },
  };
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as {
  diagnosticAttempt: Record<string, ReturnType<typeof vi.fn>>;
  diagnosticSession: Record<string, ReturnType<typeof vi.fn>>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveDiagnosticDraft", () => {
  it("throws ATTEMPT_NOT_FOUND for a different student", async () => {
    mocked.diagnosticAttempt.findUnique.mockResolvedValue({
      submittedAt: null,
      diagnosticSession: { studentId: "someone-else" },
    });

    await expect(saveDiagnosticDraft("student1", "attempt1", { draftAnswer: "c1" })).rejects.toThrow(/not found/i);
  });

  it("does not overwrite an already-submitted (locked) answer", async () => {
    const submitted = { submittedAt: new Date(), diagnosticSession: { studentId: "student1" } };
    mocked.diagnosticAttempt.findUnique.mockResolvedValue(submitted);

    const result = await saveDiagnosticDraft("student1", "attempt1", { draftAnswer: "c1" });

    expect(result).toBe(submitted);
    expect(mocked.diagnosticAttempt.update).not.toHaveBeenCalled();
  });

  it("saves a draft answer for an unsubmitted attempt", async () => {
    mocked.diagnosticAttempt.findUnique.mockResolvedValue({ submittedAt: null, diagnosticSession: { studentId: "student1" } });
    mocked.diagnosticAttempt.update.mockResolvedValue({ draftAnswer: "c1" });

    await saveDiagnosticDraft("student1", "attempt1", { draftAnswer: "c1" });

    expect(mocked.diagnosticAttempt.update).toHaveBeenCalledWith({
      where: { id: "attempt1" },
      data: { draftAnswer: "c1" },
    });
  });
});

describe("saveDiagnosticPosition", () => {
  it("throws SESSION_NOT_FOUND when no session exists", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue(null);

    await expect(saveDiagnosticPosition("student1", 5)).rejects.toThrow(/not found/i);
  });

  it("does not update position once the session is completed", async () => {
    const completed = { status: "COMPLETED" };
    mocked.diagnosticSession.findUnique.mockResolvedValue(completed);

    const result = await saveDiagnosticPosition("student1", 5);

    expect(result).toBe(completed);
    expect(mocked.diagnosticSession.update).not.toHaveBeenCalled();
  });

  it("updates currentPosition for an in-progress session", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue({ status: "IN_PROGRESS" });

    await saveDiagnosticPosition("student1", 5);

    expect(mocked.diagnosticSession.update).toHaveBeenCalledWith({
      where: { studentId: "student1" },
      data: { currentPosition: 5 },
    });
  });
});
