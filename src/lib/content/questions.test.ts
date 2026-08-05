import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  archiveQuestion,
  deleteQuestionPermanently,
  duplicateQuestionContent,
  publishQuestion,
  restoreQuestion,
  unpublishQuestion,
  updateDraftContent,
} from "@/lib/content/questions";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    question: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    questionRevision: { create: vi.fn(), update: vi.fn() },
    questionAnswerChoice: { createMany: vi.fn(), deleteMany: vi.fn() },
    questionFamily: { update: vi.fn() },
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
  questionAnswerChoice: Record<string, ReturnType<typeof vi.fn>>;
  questionFamily: Record<string, ReturnType<typeof vi.fn>>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

const baseRevision = {
  id: "r1",
  questionId: "q1",
  questionText: "2 + 2 = ?",
  questionImageId: null,
  calculatorSetting: "NOT_ALLOWED",
  suggestedTimeSeconds: 60,
  acceptedAnswers: [],
  writtenExplanation: null,
  standaloneVideoId: "v1",
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
  standaloneVideo: { id: "v1", status: "READY" },
  questionImage: null,
};

function draftQuestion(overrides: Record<string, unknown> = {}) {
  return {
    id: "q1",
    status: "DRAFT",
    questionType: "MULTIPLE_CHOICE",
    category: "ALGEBRA",
    difficulty: "MEDIUM",
    familyId: null,
    currentDraftRevisionId: "r1",
    currentPublishedRevisionId: null,
    publishedAt: null,
    archivedAt: null,
    currentDraftRevision: baseRevision,
    currentPublishedRevision: null,
    family: null,
    ...overrides,
  };
}

describe("publishQuestion", () => {
  it("rejects a family-member question", async () => {
    mocked.question.findUnique.mockResolvedValue(draftQuestion({ familyId: "f1" }));
    await expect(publishQuestion("q1")).rejects.toMatchObject({ code: "FAMILY_MISMATCH" });
  });

  it("rejects a question that's already Published with no pending draft", async () => {
    mocked.question.findUnique.mockResolvedValue(
      draftQuestion({ status: "PUBLISHED", currentDraftRevisionId: null, currentDraftRevision: null }),
    );
    await expect(publishQuestion("q1")).rejects.toMatchObject({ code: "NOT_DRAFT" });
  });

  it("rejects when the publishing checklist has unresolved issues", async () => {
    mocked.question.findUnique.mockResolvedValue(
      draftQuestion({ currentDraftRevision: { ...baseRevision, questionText: "" } }),
    );
    await expect(publishQuestion("q1")).rejects.toMatchObject({ code: "PUBLISH_VALIDATION_FAILED" });
  });

  it("promotes the draft revision to published on success", async () => {
    mocked.question.findUnique.mockResolvedValue(draftQuestion());
    mocked.questionRevision.update.mockResolvedValue({});
    mocked.question.update.mockResolvedValue({});

    await publishQuestion("q1");

    expect(mocked.questionRevision.update.mock.calls[0][0]).toMatchObject({
      where: { id: "r1" },
      data: { publishedAt: expect.any(Date) },
    });
    expect(mocked.question.update.mock.calls[0][0]).toMatchObject({
      where: { id: "q1" },
      data: {
        status: "PUBLISHED",
        currentPublishedRevisionId: "r1",
        currentDraftRevisionId: null,
      },
    });
  });
});

describe("unpublishQuestion", () => {
  it("rejects a family-member question", async () => {
    mocked.question.findUnique.mockResolvedValue(
      draftQuestion({ familyId: "f1", status: "PUBLISHED" }),
    );
    await expect(unpublishQuestion("q1")).rejects.toMatchObject({ code: "FAMILY_MISMATCH" });
  });

  it("rejects a question that isn't published", async () => {
    mocked.question.findUnique.mockResolvedValue(draftQuestion({ status: "DRAFT" }));
    await expect(unpublishQuestion("q1")).rejects.toMatchObject({ code: "NOT_PUBLISHED" });
  });

  it("moves the published revision back into the draft slot and clears live status", async () => {
    mocked.question.findUnique.mockResolvedValue(
      draftQuestion({
        status: "PUBLISHED",
        currentDraftRevisionId: null,
        currentDraftRevision: null,
        currentPublishedRevisionId: "r1",
      }),
    );
    mocked.question.update.mockResolvedValue({});

    await unpublishQuestion("q1");

    expect(mocked.question.update.mock.calls[0][0].data).toMatchObject({
      status: "DRAFT",
      publishedAt: null,
      currentPublishedRevisionId: null,
      currentDraftRevisionId: "r1",
    });
  });
});

describe("archiveQuestion / restoreQuestion", () => {
  it("blocks archiving while Published", async () => {
    mocked.question.findUnique.mockResolvedValue(draftQuestion({ status: "PUBLISHED" }));
    await expect(archiveQuestion("q1")).rejects.toMatchObject({ code: "NOT_ARCHIVABLE" });
  });

  it("blocks archiving while a Draft Revision is pending", async () => {
    mocked.question.findUnique.mockResolvedValue(draftQuestion({ status: "DRAFT_REVISION" }));
    await expect(archiveQuestion("q1")).rejects.toMatchObject({ code: "NOT_ARCHIVABLE" });
  });

  it("archives from Draft", async () => {
    mocked.question.findUnique.mockResolvedValue(draftQuestion({ status: "DRAFT" }));
    mocked.question.update.mockResolvedValue({});
    await archiveQuestion("q1");
    expect(mocked.question.update.mock.calls[0][0].data).toMatchObject({ status: "ARCHIVED" });
  });

  it("restores an archived question back to Draft", async () => {
    mocked.question.findUnique.mockResolvedValue(draftQuestion({ status: "ARCHIVED" }));
    mocked.question.update.mockResolvedValue({});
    await restoreQuestion("q1");
    expect(mocked.question.update.mock.calls[0][0].data).toMatchObject({ status: "DRAFT", archivedAt: null });
  });
});

describe("deleteQuestionPermanently", () => {
  it("rejects a question that has ever been published", async () => {
    mocked.question.findUnique.mockResolvedValue(draftQuestion({ publishedAt: new Date() }));
    await expect(deleteQuestionPermanently("q1")).rejects.toMatchObject({ code: "HAS_REFERENCES" });
  });

  it("rejects a question that belongs to a family", async () => {
    mocked.question.findUnique.mockResolvedValue(draftQuestion({ familyId: "f1" }));
    await expect(deleteQuestionPermanently("q1")).rejects.toMatchObject({ code: "HAS_REFERENCES" });
  });

  it("deletes a never-published standalone question", async () => {
    mocked.question.findUnique.mockResolvedValue(draftQuestion());
    mocked.question.delete.mockResolvedValue({});
    await deleteQuestionPermanently("q1");
    expect(mocked.question.delete).toHaveBeenCalledWith({ where: { id: "q1" } });
  });
});

describe("updateDraftContent — editing a Published question creates a Draft Revision", () => {
  it("clones the published revision instead of editing it in place", async () => {
    const published = draftQuestion({
      status: "PUBLISHED",
      currentDraftRevisionId: null,
      currentDraftRevision: null,
      currentPublishedRevisionId: "r1",
      currentPublishedRevision: baseRevision,
    });
    mocked.question.findUnique.mockResolvedValueOnce(published).mockResolvedValueOnce(published);
    mocked.questionRevision.create.mockResolvedValue({ id: "r2" });
    mocked.question.update.mockResolvedValue({});
    mocked.questionRevision.update.mockResolvedValue({});

    await updateDraftContent("q1", { questionText: "Updated text" });

    expect(mocked.questionRevision.create).toHaveBeenCalledTimes(1);
    const cloneCall = mocked.questionRevision.create.mock.calls[0][0].data;
    expect(cloneCall.questionText).toBe(baseRevision.questionText); // clone copies old content verbatim
    expect(mocked.question.update.mock.calls[0][0].data).toMatchObject({
      currentDraftRevisionId: "r2",
      status: "DRAFT_REVISION",
    });
    // the actual patch is applied to the NEW cloned revision, not the old one
    expect(mocked.questionRevision.update.mock.calls[0][0]).toMatchObject({
      where: { id: "r2" },
      data: { questionText: "Updated text" },
    });
  });

  it("edits the existing draft revision directly when the question is already a Draft", async () => {
    const draft = draftQuestion();
    mocked.question.findUnique.mockResolvedValueOnce(draft).mockResolvedValueOnce(draft);
    mocked.questionRevision.update.mockResolvedValue({});

    await updateDraftContent("q1", { questionText: "Edited" });

    expect(mocked.questionRevision.create).not.toHaveBeenCalled();
    expect(mocked.questionRevision.update.mock.calls[0][0]).toMatchObject({
      where: { id: "r1" },
      data: { questionText: "Edited" },
    });
  });

  it("resets previewCompletedAt on every content edit", async () => {
    const draft = draftQuestion();
    mocked.question.findUnique.mockResolvedValueOnce(draft).mockResolvedValueOnce(draft);
    mocked.questionRevision.update.mockResolvedValue({});

    await updateDraftContent("q1", { suggestedTimeSeconds: 90 });

    expect(mocked.questionRevision.update.mock.calls[0][0].data).toMatchObject({ previewCompletedAt: null });
  });

  it("rejects edits to an archived question", async () => {
    mocked.question.findUnique.mockResolvedValue(draftQuestion({ status: "ARCHIVED" }));
    await expect(updateDraftContent("q1", { questionText: "x" })).rejects.toMatchObject({ code: "NOT_DRAFT" });
  });
});

describe("duplicateQuestionContent", () => {
  it("copies content into a new standalone Draft with a fresh id", async () => {
    mocked.question.findUnique
      .mockResolvedValueOnce(draftQuestion())
      .mockResolvedValueOnce({ ...draftQuestion(), id: "q2" });
    mocked.question.create.mockResolvedValue({ id: "q2" });
    mocked.questionRevision.create.mockResolvedValue({ id: "r2" });
    mocked.question.update.mockResolvedValue({});

    await duplicateQuestionContent("q1");

    const createCall = mocked.question.create.mock.calls[0][0].data;
    expect(createCall.status).toBe("DRAFT");
    expect(createCall.questionType).toBe("MULTIPLE_CHOICE");

    const revisionCall = mocked.questionRevision.create.mock.calls[0][0].data;
    expect(revisionCall.questionText).toBe(baseRevision.questionText);
    expect(revisionCall.answerChoices.create).toHaveLength(4);
  });

  it("clears the standalone video reference when duplicating a family member", async () => {
    const familyMember = draftQuestion({ familyId: "f1" });
    mocked.question.findUnique.mockResolvedValueOnce(familyMember).mockResolvedValueOnce({ ...familyMember, id: "q2" });
    mocked.question.create.mockResolvedValue({ id: "q2" });
    mocked.questionRevision.create.mockResolvedValue({ id: "r2" });
    mocked.question.update.mockResolvedValue({});

    await duplicateQuestionContent("q1");

    const revisionCall = mocked.questionRevision.create.mock.calls[0][0].data;
    expect(revisionCall.standaloneVideoId).toBeNull();
  });
});
