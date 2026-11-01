import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWalkthroughFeedbackReport, sortFeedbackReport, type FeedbackRow } from "./walkthrough-feedback";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: vi.fn(), question: { findMany: vi.fn() } } }));

const queryRaw = prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>;
const findQuestions = prisma.question.findMany as unknown as ReturnType<typeof vi.fn>;

function sqlOf(call: unknown[]): string {
  return (call[0] as TemplateStringsArray).join("?");
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getWalkthroughFeedbackReport", () => {
  it("counts in the database and leaves out every example.com account, demo and load-test ones included", async () => {
    queryRaw.mockResolvedValue([]);

    expect(await getWalkthroughFeedbackReport()).toEqual([]);

    const sql = sqlOf(queryRaw.mock.calls[0]);
    expect(sql).toContain(`NOT LIKE '%example.com%'`);
    expect(sql).toContain("GROUP BY");
    // Nothing to describe, so no second query.
    expect(findQuestions).not.toHaveBeenCalled();
  });

  it("joins the totals to each question's text and puts the most confusing first", async () => {
    queryRaw.mockResolvedValue([
      { questionId: "clear", helpful: 9, confused: 1, worstStep: null, worstStepCount: null },
      { questionId: "muddled", helpful: 1, confused: 3, worstStep: 2, worstStepCount: 2 },
    ]);
    findQuestions.mockResolvedValue([
      { id: "clear", category: "ALGEBRA", difficulty: "EASY", currentPublishedRevision: { questionText: "What is  2 + 2?" } },
      { id: "muddled", category: "GRAMMAR", difficulty: "HARD", currentPublishedRevision: { questionText: "Which choice…" } },
    ]);

    const report = await getWalkthroughFeedbackReport();

    expect(report.map((r) => r.questionId)).toEqual(["muddled", "clear"]);
    expect(report[0]).toMatchObject({ helpful: 1, confused: 3, worstStep: { step: 2, count: 2 } });
    expect(report[1]).toMatchObject({ preview: "What is 2 + 2?", worstStep: null });
  });
});

describe("sortFeedbackReport", () => {
  const row = (questionId: string, helpful: number, confused: number): FeedbackRow => ({
    questionId,
    preview: "",
    category: "ALGEBRA",
    difficulty: "EASY",
    helpful,
    confused,
    worstStep: null,
  });

  it("breaks a tie on share by how many were confused", () => {
    expect(sortFeedbackReport([row("few", 1, 1), row("many", 5, 5)]).map((r) => r.questionId)).toEqual(["many", "few"]);
  });
});
