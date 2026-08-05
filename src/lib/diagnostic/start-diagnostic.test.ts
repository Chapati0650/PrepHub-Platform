import { beforeEach, describe, expect, it, vi } from "vitest";
import { startOrResumeDiagnostic } from "@/lib/diagnostic/start-diagnostic";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    diagnosticSession: { findUnique: vi.fn(), create: vi.fn() },
    question: { findMany: vi.fn() },
  };
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as {
  diagnosticSession: Record<string, ReturnType<typeof vi.fn>>;
  question: Record<string, ReturnType<typeof vi.fn>>;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocked.diagnosticSession.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
    id: "session1",
    ...data,
    attempts: (data.attempts as { create: unknown[] }).create,
  }));
});

function abundantBank() {
  let counter = 0;
  mocked.question.findMany.mockImplementation(() => {
    counter++;
    return Promise.resolve([{ id: `q${counter}`, currentPublishedRevisionId: `r${counter}` }]);
  });
}

describe("startOrResumeDiagnostic", () => {
  it("resumes an existing session instead of creating a new one", async () => {
    const existing = { id: "existing", attempts: [] };
    mocked.diagnosticSession.findUnique.mockResolvedValue(existing);

    const result = await startOrResumeDiagnostic("student1");

    expect(result).toBe(existing);
    expect(mocked.diagnosticSession.create).not.toHaveBeenCalled();
  });

  it("creates exactly 21 attempts covering all 7 categories with one Easy, one Medium, one Hard each", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue(null);
    abundantBank();

    const result = (await startOrResumeDiagnostic("student1")) as {
      attempts: { category: string; difficulty: string; questionId: string }[];
    };

    expect(result.attempts).toHaveLength(21);
    for (const category of ALL_CATEGORIES) {
      const forCategory = result.attempts.filter((a) => a.category === category);
      expect(forCategory).toHaveLength(3);
      expect(forCategory.map((a) => a.difficulty).sort()).toEqual(["EASY", "HARD", "MEDIUM"]);
    }
  });

  it("never selects the same exact question twice", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue(null);
    abundantBank();

    const result = (await startOrResumeDiagnostic("student1")) as { attempts: { questionId: string }[] };

    const ids = result.attempts.map((a) => a.questionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("throws GENERATION_FAILED without creating a session when a required pool has no content", async () => {
    mocked.diagnosticSession.findUnique.mockResolvedValue(null);
    mocked.question.findMany.mockResolvedValue([]);

    await expect(startOrResumeDiagnostic("student1")).rejects.toThrow();
    expect(mocked.diagnosticSession.create).not.toHaveBeenCalled();
  });
});
