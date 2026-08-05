import { describe, expect, it } from "vitest";
import { buildWhere } from "@/lib/content/list-questions";
import type { Prisma } from "@/generated/prisma/client";

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
});
