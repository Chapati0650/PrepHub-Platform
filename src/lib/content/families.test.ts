import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  addVersionToFamily,
  archiveFamily,
  createEmptyFamily,
  groupExistingQuestionsIntoFamily,
  publishFamily,
  unpublishFamily,
} from "@/lib/content/families";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    question: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), delete: vi.fn() },
    questionRevision: { create: vi.fn(), update: vi.fn() },
    questionAnswerChoice: { createMany: vi.fn(), deleteMany: vi.fn() },
    questionFamily: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(),
  };
  (mockPrisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation((arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: unknown) => unknown)(mockPrisma);
    return Promise.all(arg as Promise<unknown>[]);
  });
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as {
  question: Record<string, ReturnType<typeof vi.fn>>;
  questionRevision: Record<string, ReturnType<typeof vi.fn>>;
  questionFamily: Record<string, ReturnType<typeof vi.fn>>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

const readyVideo = { id: "v1", status: "READY" };

function revision(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    questionId: "q1",
    questionText: "2 + 2 = ?",
    questionImageId: null,
    calculatorSetting: "NOT_ALLOWED",
    suggestedTimeSeconds: 60,
    acceptedAnswers: [],
    writtenExplanation: null,
    standaloneVideoId: null,
    previewCompletedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    publishedAt: null,
    answerChoices: [0, 1, 2, 3].map((order) => ({
      id: `c${order}`,
      revisionId: "r1",
      order,
      text: `Choice ${order}`,
      isCorrect: order === 0,
      imageId: null,
    })),
    standaloneVideo: null,
    questionImage: null,
    ...overrides,
  };
}

function familyQuestion(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "DRAFT",
    questionType: "MULTIPLE_CHOICE",
    category: "ALGEBRA",
    difficulty: "MEDIUM",
    familyId: "f1",
    currentDraftRevisionId: `r-${id}`,
    currentPublishedRevisionId: null,
    publishedAt: null,
    archivedAt: null,
    currentDraftRevision: revision({ id: `r-${id}`, questionId: id }),
    currentPublishedRevision: null,
    family: null,
    ...overrides,
  };
}

function family(overrides: Record<string, unknown> = {}) {
  return {
    id: "f1",
    status: "DRAFT",
    internalName: "Linear equations",
    category: "ALGEBRA",
    difficulty: "MEDIUM",
    sharedVideoId: "v1",
    createdAt: new Date(),
    updatedAt: new Date(),
    publishedAt: null,
    archivedAt: null,
    sharedVideo: readyVideo,
    questions: [familyQuestion("q1"), familyQuestion("q2"), familyQuestion("q3")],
    ...overrides,
  };
}

describe("createEmptyFamily", () => {
  it("rejects a non-math category", async () => {
    await expect(
      createEmptyFamily({ category: "GRAMMAR", difficulty: "EASY" }),
    ).rejects.toMatchObject({ code: "FAMILY_INELIGIBLE_CATEGORY" });
  });

  it("creates a Draft family for an eligible math category", async () => {
    mocked.questionFamily.create.mockResolvedValue({ id: "f1" });
    mocked.questionFamily.findUnique.mockResolvedValue(family({ status: "DRAFT" }));

    await createEmptyFamily({ category: "ALGEBRA", difficulty: "MEDIUM" });

    expect(mocked.questionFamily.create.mock.calls[0][0].data).toMatchObject({
      category: "ALGEBRA",
      difficulty: "MEDIUM",
    });
  });
});

describe("addVersionToFamily", () => {
  it("rejects a Published question", async () => {
    mocked.questionFamily.findUnique.mockResolvedValue(family({ questions: [familyQuestion("q1"), familyQuestion("q2")] }));
    mocked.question.findUnique.mockResolvedValue({
      id: "q4",
      status: "PUBLISHED",
      familyId: null,
      category: "ALGEBRA",
      difficulty: "MEDIUM",
    });
    await expect(addVersionToFamily("f1", "q4")).rejects.toMatchObject({ code: "FAMILY_MISMATCH" });
  });

  it("rejects a question already in a family", async () => {
    mocked.questionFamily.findUnique.mockResolvedValue(family({ questions: [familyQuestion("q1")] }));
    mocked.question.findUnique.mockResolvedValue({
      id: "q4",
      status: "DRAFT",
      familyId: "other-family",
      category: "ALGEBRA",
      difficulty: "MEDIUM",
    });
    await expect(addVersionToFamily("f1", "q4")).rejects.toMatchObject({ code: "ALREADY_IN_FAMILY" });
  });

  it("rejects a category/difficulty mismatch", async () => {
    mocked.questionFamily.findUnique.mockResolvedValue(family({ questions: [familyQuestion("q1")] }));
    mocked.question.findUnique.mockResolvedValue({
      id: "q4",
      status: "DRAFT",
      familyId: null,
      category: "ALGEBRA",
      difficulty: "HARD",
    });
    await expect(addVersionToFamily("f1", "q4")).rejects.toMatchObject({ code: "FAMILY_MISMATCH" });
  });

  it("rejects adding a 4th version to an already-full family", async () => {
    mocked.questionFamily.findUnique.mockResolvedValue(family()); // already has 3
    mocked.question.findUnique.mockResolvedValue({
      id: "q4",
      status: "DRAFT",
      familyId: null,
      category: "ALGEBRA",
      difficulty: "MEDIUM",
    });
    await expect(addVersionToFamily("f1", "q4")).rejects.toMatchObject({ code: "FAMILY_FULL" });
  });

  it("assigns an eligible Draft question to a non-full family", async () => {
    mocked.questionFamily.findUnique.mockResolvedValue(family({ questions: [familyQuestion("q1")] }));
    mocked.question.findUnique.mockResolvedValue({
      id: "q4",
      status: "DRAFT",
      familyId: null,
      category: "ALGEBRA",
      difficulty: "MEDIUM",
    });
    mocked.question.update.mockResolvedValue({});

    await addVersionToFamily("f1", "q4");

    expect(mocked.question.update).toHaveBeenCalledWith({ where: { id: "q4" }, data: { familyId: "f1" } });
  });
});

describe("groupExistingQuestionsIntoFamily", () => {
  it("rejects more than 3 selected questions", async () => {
    await expect(
      groupExistingQuestionsIntoFamily({ questionIds: ["a", "b", "c", "d"] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects mismatched category/difficulty across the selection", async () => {
    mocked.question.findMany.mockResolvedValue([
      { id: "a", status: "DRAFT", familyId: null, category: "ALGEBRA", difficulty: "MEDIUM" },
      { id: "b", status: "DRAFT", familyId: null, category: "ALGEBRA", difficulty: "HARD" },
    ]);
    await expect(
      groupExistingQuestionsIntoFamily({ questionIds: ["a", "b"] }),
    ).rejects.toMatchObject({ code: "FAMILY_MISMATCH" });
  });

  it("rejects when any selected question is already Published", async () => {
    mocked.question.findMany.mockResolvedValue([
      { id: "a", status: "PUBLISHED", familyId: null, category: "ALGEBRA", difficulty: "MEDIUM" },
    ]);
    await expect(
      groupExistingQuestionsIntoFamily({ questionIds: ["a"] }),
    ).rejects.toMatchObject({ code: "FAMILY_MISMATCH" });
  });

  it("groups eligible matching Draft questions into a new family", async () => {
    mocked.question.findMany.mockResolvedValue([
      { id: "a", status: "DRAFT", familyId: null, category: "ALGEBRA", difficulty: "MEDIUM" },
      { id: "b", status: "DRAFT", familyId: null, category: "ALGEBRA", difficulty: "MEDIUM" },
    ]);
    mocked.questionFamily.create.mockResolvedValue({ id: "f1" });
    mocked.question.updateMany.mockResolvedValue({ count: 2 });
    mocked.questionFamily.findUnique.mockResolvedValue(family());

    await groupExistingQuestionsIntoFamily({ questionIds: ["a", "b"] });

    expect(mocked.questionFamily.create.mock.calls[0][0].data).toMatchObject({
      category: "ALGEBRA",
      difficulty: "MEDIUM",
    });
    expect(mocked.question.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: { in: ["a", "b"] } },
      data: { familyId: "f1" },
    });
  });
});

describe("publishFamily", () => {
  it("rejects an incomplete family", async () => {
    mocked.questionFamily.findUnique.mockResolvedValue(family({ questions: [familyQuestion("q1")] }));
    await expect(publishFamily("f1")).rejects.toMatchObject({ code: "FAMILY_INCOMPLETE" });
  });

  it("rejects when any version fails the publishing checklist, publishing none of them", async () => {
    mocked.questionFamily.findUnique.mockResolvedValue(
      family({
        questions: [
          familyQuestion("q1"),
          familyQuestion("q2", { currentDraftRevision: revision({ id: "r-q2", questionId: "q2", questionText: "" }) }),
          familyQuestion("q3"),
        ],
      }),
    );
    await expect(publishFamily("f1")).rejects.toMatchObject({ code: "PUBLISH_VALIDATION_FAILED" });
    expect(mocked.question.update).not.toHaveBeenCalled();
  });

  it("publishes all three versions and the family atomically when valid", async () => {
    mocked.questionFamily.findUnique.mockResolvedValue(family());
    mocked.questionRevision.update.mockResolvedValue({});
    mocked.question.update.mockResolvedValue({});
    mocked.questionFamily.update.mockResolvedValue({});

    await publishFamily("f1");

    expect(mocked.question.update).toHaveBeenCalledTimes(3);
    for (const call of mocked.question.update.mock.calls) {
      expect(call[0].data).toMatchObject({ status: "PUBLISHED", currentDraftRevisionId: null });
    }
    expect(mocked.questionFamily.update.mock.calls[0][0].data).toMatchObject({ status: "PUBLISHED" });
  });
});

describe("unpublishFamily", () => {
  it("rejects a family that isn't published", async () => {
    mocked.questionFamily.findUnique.mockResolvedValue(family({ status: "DRAFT" }));
    await expect(unpublishFamily("f1")).rejects.toMatchObject({ code: "NOT_PUBLISHED" });
  });

  it("unpublishes every published member and the family", async () => {
    mocked.questionFamily.findUnique.mockResolvedValue(
      family({
        status: "PUBLISHED",
        questions: [
          familyQuestion("q1", { status: "PUBLISHED", currentDraftRevisionId: null, currentPublishedRevisionId: "r-q1" }),
          familyQuestion("q2", { status: "PUBLISHED", currentDraftRevisionId: null, currentPublishedRevisionId: "r-q2" }),
          familyQuestion("q3", { status: "PUBLISHED", currentDraftRevisionId: null, currentPublishedRevisionId: "r-q3" }),
        ],
      }),
    );
    mocked.question.update.mockResolvedValue({});
    mocked.questionFamily.update.mockResolvedValue({});

    await unpublishFamily("f1");

    expect(mocked.question.update).toHaveBeenCalledTimes(3);
    expect(mocked.questionFamily.update.mock.calls[0][0].data).toMatchObject({ status: "DRAFT", publishedAt: null });
  });
});

describe("archiveFamily", () => {
  it("blocks archiving a published family", async () => {
    mocked.questionFamily.findUnique.mockResolvedValue(family({ status: "PUBLISHED" }));
    await expect(archiveFamily("f1")).rejects.toMatchObject({ code: "NOT_ARCHIVABLE" });
  });

  it("archives every member alongside the family", async () => {
    mocked.questionFamily.findUnique.mockResolvedValue(family({ status: "DRAFT" }));
    mocked.question.updateMany.mockResolvedValue({ count: 3 });
    mocked.questionFamily.update.mockResolvedValue({});

    await archiveFamily("f1");

    expect(mocked.question.updateMany.mock.calls[0][0]).toMatchObject({
      where: { familyId: "f1", status: { not: "ARCHIVED" } },
      data: { status: "ARCHIVED" },
    });
    expect(mocked.questionFamily.update.mock.calls[0][0].data).toMatchObject({ status: "ARCHIVED" });
  });
});
