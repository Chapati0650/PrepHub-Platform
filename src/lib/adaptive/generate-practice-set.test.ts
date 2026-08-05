import { beforeEach, describe, expect, it, vi } from "vitest";
import { generatePracticeSet } from "@/lib/adaptive/generate-practice-set";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    practiceSet: { findFirst: vi.fn(), aggregate: vi.fn(), create: vi.fn() },
    categoryState: { findMany: vi.fn() },
    finalizedAttempt: { findMany: vi.fn() },
    diagnosticAttempt: { findMany: vi.fn() },
    question: { findMany: vi.fn() },
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
  finalizedAttempt: Record<string, ReturnType<typeof vi.fn>>;
  diagnosticAttempt: Record<string, ReturnType<typeof vi.fn>>;
  question: Record<string, ReturnType<typeof vi.fn>>;
};

// Plenty of published, unseen questions in every (category, difficulty) pair
// so real allocation/difficulty/selection logic can run without ever hitting
// content-availability fallback in the "happy path" tests.
function abundantQuestionBank() {
  mocked.question.findMany.mockImplementation(({ where }: { where: { category: string; difficulty: string } }) => {
    const ids = Array.from({ length: 20 }, (_, i) => `${where.category}_${where.difficulty}_${i}`);
    return Promise.resolve(
      ids.map((id) => ({ id, familyId: null, currentPublishedRevisionId: `${id}_rev` })),
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.practiceSet.findFirst.mockResolvedValue(null);
  mocked.practiceSet.aggregate.mockResolvedValue({ _max: { setNumber: null } });
  mocked.finalizedAttempt.findMany.mockResolvedValue([]);
  mocked.diagnosticAttempt.findMany.mockResolvedValue([]);
  mocked.practiceSet.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
    id: "set1",
    ...data,
    slots: (data.slots as { create: unknown[] }).create,
  }));
  abundantQuestionBank();
});

function categoryStatesAt(ability: number) {
  return ALL_CATEGORIES.map((category) => ({
    category,
    ability,
    initialAbility: ability,
    adaptiveQuestionsAnswered: 0,
    consecutiveSetsWithoutExtraAllocation: 0,
  }));
}

describe("generatePracticeSet", () => {
  it("returns the existing Active Practice Set instead of generating a new one", async () => {
    const existing = { id: "existing-set", status: "ACTIVE", slots: [] };
    mocked.practiceSet.findFirst.mockResolvedValue(existing);

    const result = await generatePracticeSet("student1");

    expect(result).toBe(existing);
    expect(mocked.practiceSet.create).not.toHaveBeenCalled();
  });

  it("generates exactly 21 slots covering every category at least once, none more than five", async () => {
    mocked.categoryState.findMany.mockResolvedValue(categoryStatesAt(50));

    const result = await generatePracticeSet("student1");
    const slots = (result as { slots: { resolvedCategory: string }[] }).slots;

    expect(slots).toHaveLength(21);
    const counts = new Map<string, number>();
    for (const slot of slots) counts.set(slot.resolvedCategory, (counts.get(slot.resolvedCategory) ?? 0) + 1);
    for (const category of ALL_CATEGORIES) {
      expect(counts.get(category) ?? 0).toBeGreaterThanOrEqual(1);
      expect(counts.get(category) ?? 0).toBeLessThanOrEqual(5);
    }
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(21);
  });

  it("never selects the same Exact Question twice in one set", async () => {
    mocked.categoryState.findMany.mockResolvedValue(categoryStatesAt(50));

    const result = await generatePracticeSet("student1");
    const slots = (result as { slots: { questionId: string }[] }).slots;

    const ids = slots.map((s) => s.questionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("assigns sequential setNumber starting at 1 (diagnostic does not count)", async () => {
    mocked.categoryState.findMany.mockResolvedValue(categoryStatesAt(50));
    mocked.practiceSet.aggregate.mockResolvedValue({ _max: { setNumber: null } });

    const result = await generatePracticeSet("student1");

    expect((result as { setNumber: number }).setNumber).toBe(1);
  });

  it("uses the next sequential setNumber when prior sets exist", async () => {
    mocked.categoryState.findMany.mockResolvedValue(categoryStatesAt(50));
    mocked.practiceSet.aggregate.mockResolvedValue({ _max: { setNumber: 3 } });

    const result = await generatePracticeSet("student1");

    expect((result as { setNumber: number }).setNumber).toBe(4);
  });

  it("throws GENERATION_FAILED and creates nothing when category states are missing (no diagnostic yet)", async () => {
    mocked.categoryState.findMany.mockResolvedValue([]);

    await expect(generatePracticeSet("student1")).rejects.toThrow(/diagnostic/i);
    expect(mocked.practiceSet.create).not.toHaveBeenCalled();
  });

  it("falls back across categories and still produces a complete 21-question set when one category's bank is exhausted", async () => {
    mocked.categoryState.findMany.mockResolvedValue(categoryStatesAt(50));
    const starvedCategory = ALL_CATEGORIES[0];
    mocked.question.findMany.mockImplementation(({ where }: { where: { category: string; difficulty: string } }) => {
      if (where.category === starvedCategory) return Promise.resolve([]);
      const ids = Array.from({ length: 20 }, (_, i) => `${where.category}_${where.difficulty}_${i}`);
      return Promise.resolve(ids.map((id) => ({ id, familyId: null, currentPublishedRevisionId: `${id}_rev` })));
    });

    const result = await generatePracticeSet("student1");
    const slots = (result as { slots: { resolvedCategory: string; plannedCategory: string }[] }).slots;

    expect(slots).toHaveLength(21);
    // The starved category's planned slots must have been reassigned elsewhere.
    expect(slots.some((s) => s.resolvedCategory === starvedCategory)).toBe(false);
    expect(slots.some((s) => s.plannedCategory === starvedCategory)).toBe(true);
  });

  it("throws GENERATION_FAILED without creating a set when no category has any eligible content", async () => {
    mocked.categoryState.findMany.mockResolvedValue(categoryStatesAt(50));
    mocked.question.findMany.mockResolvedValue([]);

    await expect(generatePracticeSet("student1")).rejects.toThrow();
    expect(mocked.practiceSet.create).not.toHaveBeenCalled();
  });
});
