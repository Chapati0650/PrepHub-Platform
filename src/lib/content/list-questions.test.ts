import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildWhere, listQuestions } from "@/lib/content/list-questions";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({ prisma: { question: { findMany: vi.fn(), count: vi.fn() } } }));

const findMany = prisma.question.findMany as unknown as ReturnType<typeof vi.fn>;

// buildWhere always returns { AND: [...] } (see list-questions.ts) — Prisma's
// generated type just allows AND to be a single clause too, which we never use.
function andClauses(filters: Parameters<typeof buildWhere>[0]): Prisma.QuestionWhereInput[] {
  return buildWhere(filters).AND as Prisma.QuestionWhereInput[];
}

describe("buildWhere", () => {
  it("excludes archived questions by default", () => {
    expect(andClauses({})).toContainEqual({ status: { not: "ARCHIVED" } });
  });

  it("includes archived questions only when explicitly filtered for", () => {
    const clauses = andClauses({ status: "ARCHIVED" });
    expect(clauses).toContainEqual({ status: "ARCHIVED" });
    expect(clauses).not.toContainEqual({ status: { not: "ARCHIVED" } });
  });

  it("combines category, difficulty, and type filters", () => {
    const clauses = andClauses({ category: "ALGEBRA", difficulty: "HARD", questionType: "MULTIPLE_CHOICE" });
    expect(clauses).toContainEqual({ category: "ALGEBRA" });
    expect(clauses).toContainEqual({ difficulty: "HARD" });
    expect(clauses).toContainEqual({ questionType: "MULTIPLE_CHOICE" });
  });

  it("searches the draft revision OR the published revision when there's no pending draft", () => {
    const clause = andClauses({ search: "quadratic" }).find((c) => "OR" in c) as { OR: unknown[] };
    expect(clause).toBeDefined();
    expect(clause.OR).toEqual([
      { currentDraftRevision: { questionText: { contains: "quadratic", mode: "insensitive" } } },
      {
        AND: [
          { currentDraftRevisionId: null },
          { currentPublishedRevision: { questionText: { contains: "quadratic", mode: "insensitive" } } },
        ],
      },
    ]);
  });

  it("maps family membership filters to familyId presence", () => {
    expect(andClauses({ familyMembership: "IN_FAMILY" })).toContainEqual({ familyId: { not: null } });
    expect(andClauses({ familyMembership: "NOT_IN_FAMILY" })).toContainEqual({ familyId: null });
  });

  it("maps NEEDS_REVIEW to aiGenerated-and-unreviewed on whichever revision is editable", () => {
    const clause = andClauses({ reviewStatus: "NEEDS_REVIEW" }).find((c) => "OR" in c) as { OR: unknown[] };
    expect(clause).toBeDefined();
    expect(clause.OR).toEqual([
      { currentDraftRevisionId: { not: null }, currentDraftRevision: { aiGenerated: true, aiReviewedAt: null } },
      { currentDraftRevisionId: null, currentPublishedRevision: { aiGenerated: true, aiReviewedAt: null } },
    ]);
  });

  it("maps REVIEWED to aiGenerated-and-reviewed on whichever revision is editable", () => {
    const clause = andClauses({ reviewStatus: "REVIEWED" }).find((c) => "OR" in c) as { OR: unknown[] };
    expect(clause).toBeDefined();
    expect(clause.OR).toEqual([
      { currentDraftRevisionId: { not: null }, currentDraftRevision: { aiGenerated: true, aiReviewedAt: { not: null } } },
      { currentDraftRevisionId: null, currentPublishedRevision: { aiGenerated: true, aiReviewedAt: { not: null } } },
    ]);
  });
});

describe("listQuestions — category and difficulty sorts", () => {
  // In the database's stable order (most recently updated first).
  const bank = [
    { id: "g1", category: "GRAMMAR", difficulty: "HARD" },
    { id: "a1", category: "ALGEBRA", difficulty: "EASY" },
    { id: "r1", category: "READING_COMPREHENSION", difficulty: "MEDIUM" },
    { id: "a2", category: "ALGEBRA", difficulty: "HARD" },
  ];

  beforeEach(() => {
    findMany.mockReset();
    findMany.mockImplementation((args: { select?: unknown; where: { id?: { in: string[] } } }) => {
      if (args.select) return Promise.resolve(bank);
      // The page's own rows, deliberately not in the order asked for.
      const ids = args.where.id?.in ?? [];
      return Promise.resolve([...ids].reverse().map((id) => ({ id, full: true })));
    });
  });

  it("sorts a lightweight projection, then loads only the requested page with its content", async () => {
    const result = await listQuestions({ sort: "CATEGORY", page: 1, pageSize: 25 });

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[0][0].select).toEqual({ id: true, category: true, difficulty: true });
    expect(findMany.mock.calls[0][0].include).toBeUndefined();
    // Reading Comprehension, then Grammar, then Algebra — PRD-013's order —
    // with the stable order kept inside a category.
    expect(findMany.mock.calls[1][0].where).toEqual({ id: { in: ["r1", "g1", "a1", "a2"] } });
    expect(result.rows.map((r) => r.id)).toEqual(["r1", "g1", "a1", "a2"]);
    expect(result.totalCount).toBe(4);
  });

  it("pages after sorting, so page 2 holds what follows page 1", async () => {
    const result = await listQuestions({ sort: "DIFFICULTY", page: 2, pageSize: 25 });
    expect(result.rows).toEqual([]);
    expect(result.totalCount).toBe(4);
    // Nothing on the page, so nothing more to load.
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
