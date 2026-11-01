import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  archiveQuestion,
  createQuestion,
  deleteQuestionPermanently,
  duplicateQuestionContent,
  findQuestionIdByExactText,
  findQuestionIdsByImageHash,
  publishQuestion,
  restoreQuestion,
  unpublishQuestion,
  updateDraftContent,
} from "@/lib/content/questions";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = {
    question: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
    questionRevision: { create: vi.fn(), update: vi.fn() },
    questionAnswerChoice: { createMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
    explanationStep: { createMany: vi.fn(), deleteMany: vi.fn() },
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
  explanationStep: Record<string, ReturnType<typeof vi.fn>>;
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
  explanationSteps: [],
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

describe("createQuestion — calculator access is derived from category", () => {
  it.each([
    ["ALGEBRA", "ALLOWED"],
    ["GEOMETRY_TRIGONOMETRY", "ALLOWED"],
    ["ADVANCED_MATH", "ALLOWED"],
    ["PROBLEM_SOLVING_DATA_ANALYSIS", "ALLOWED"],
    ["READING_COMPREHENSION", "NOT_ALLOWED"],
    ["GRAMMAR", "NOT_ALLOWED"],
    ["VOCABULARY", "NOT_ALLOWED"],
  ] as const)("sets calculatorSetting=%s → %s for %s", async (category, expected) => {
    mocked.question.create.mockResolvedValue({ id: "q1" });
    mocked.questionRevision.create.mockResolvedValue({ id: "r1" });
    mocked.question.update.mockResolvedValue({});
    mocked.question.findUnique.mockResolvedValue(draftQuestion({ category }));

    await createQuestion({ questionType: "OPEN_ENDED_NUMERIC", category, difficulty: "MEDIUM" });

    expect(mocked.questionRevision.create.mock.calls[0][0].data).toMatchObject({ calculatorSetting: expected });
  });
});

describe("createQuestion — suggested time is derived from difficulty", () => {
  it.each([
    ["EASY", 60],
    ["MEDIUM", 90],
    ["HARD", 180],
  ] as const)("sets suggestedTimeSeconds=%s → %s", async (difficulty, expected) => {
    mocked.question.create.mockResolvedValue({ id: "q1" });
    mocked.questionRevision.create.mockResolvedValue({ id: "r1" });
    mocked.question.update.mockResolvedValue({});
    mocked.question.findUnique.mockResolvedValue(draftQuestion({ difficulty }));

    await createQuestion({ questionType: "OPEN_ENDED_NUMERIC", category: "ALGEBRA", difficulty });

    expect(mocked.questionRevision.create.mock.calls[0][0].data).toMatchObject({ suggestedTimeSeconds: expected });
  });
});

describe("createQuestion — sourceImageHash", () => {
  it("stores the given hash on the question row", async () => {
    mocked.question.create.mockResolvedValue({ id: "q1" });
    mocked.questionRevision.create.mockResolvedValue({ id: "r1" });
    mocked.question.update.mockResolvedValue({});
    mocked.question.findUnique.mockResolvedValue(draftQuestion());

    await createQuestion({ questionType: "OPEN_ENDED_NUMERIC", category: "ALGEBRA", difficulty: "MEDIUM", sourceImageHash: "abc123" });

    expect(mocked.question.create.mock.calls[0][0].data).toMatchObject({ sourceImageHash: "abc123" });
  });

  it("defaults to null when no hash is given (hand-authored questions)", async () => {
    mocked.question.create.mockResolvedValue({ id: "q1" });
    mocked.questionRevision.create.mockResolvedValue({ id: "r1" });
    mocked.question.update.mockResolvedValue({});
    mocked.question.findUnique.mockResolvedValue(draftQuestion());

    await createQuestion({ questionType: "OPEN_ENDED_NUMERIC", category: "ALGEBRA", difficulty: "MEDIUM" });

    expect(mocked.question.create.mock.calls[0][0].data).toMatchObject({ sourceImageHash: null });
  });
});

describe("findQuestionIdsByImageHash", () => {
  it("returns the ids of every question matching that source image hash", async () => {
    mocked.question.findMany.mockResolvedValue([{ id: "q1" }, { id: "q2" }]);

    const ids = await findQuestionIdsByImageHash("abc123");

    expect(ids).toEqual(["q1", "q2"]);
    expect(mocked.question.findMany).toHaveBeenCalledWith({ where: { sourceImageHash: "abc123" }, select: { id: true } });
  });

  it("returns an empty array when nothing matches", async () => {
    mocked.question.findMany.mockResolvedValue([]);
    expect(await findQuestionIdsByImageHash("nope")).toEqual([]);
  });
});

describe("findQuestionIdByExactText", () => {
  it("returns the matching question's id when found", async () => {
    mocked.question.findFirst.mockResolvedValue({ id: "q1" });

    const id = await findQuestionIdByExactText("What is 2 + 2?");

    expect(id).toBe("q1");
  });

  it("returns null when nothing matches", async () => {
    mocked.question.findFirst.mockResolvedValue(null);
    expect(await findQuestionIdByExactText("Nothing like this exists")).toBeNull();
  });

  it("returns null without querying at all for blank text", async () => {
    expect(await findQuestionIdByExactText("   ")).toBeNull();
    expect(mocked.question.findFirst).not.toHaveBeenCalled();
  });

  it("trims surrounding whitespace before matching", async () => {
    mocked.question.findFirst.mockResolvedValue({ id: "q1" });

    await findQuestionIdByExactText("  What is 2 + 2?  \n");

    const where = mocked.question.findFirst.mock.calls[0][0].where;
    expect(where.OR[0].currentDraftRevision.questionText).toBe("What is 2 + 2?");
  });

  it("matches against the draft revision when one exists, and the published revision only when there is no draft", async () => {
    mocked.question.findFirst.mockResolvedValue({ id: "q1" });

    await findQuestionIdByExactText("What is 2 + 2?");

    const where = mocked.question.findFirst.mock.calls[0][0].where;
    expect(where.OR[0]).toEqual({ currentDraftRevision: { questionText: "What is 2 + 2?" } });
    expect(where.OR[1]).toEqual({
      AND: [{ currentDraftRevisionId: null }, { currentPublishedRevision: { questionText: "What is 2 + 2?" } }],
    });
  });
});

describe("updateDraftContent — editing a Published question", () => {
  it("edits the published revision directly and stays Published, for a standalone question (Owner request: no Draft Revision buffer)", async () => {
    const published = draftQuestion({
      status: "PUBLISHED",
      currentDraftRevisionId: null,
      currentDraftRevision: null,
      currentPublishedRevisionId: "r1",
      currentPublishedRevision: baseRevision,
    });
    mocked.question.findUnique.mockResolvedValueOnce(published).mockResolvedValueOnce(published);
    mocked.questionRevision.update.mockResolvedValue({});

    await updateDraftContent("q1", { questionText: "Updated text" });

    expect(mocked.questionRevision.create).not.toHaveBeenCalled();
    expect(mocked.question.update).not.toHaveBeenCalled();
    expect(mocked.questionRevision.update.mock.calls[0][0]).toMatchObject({
      where: { id: "r1" },
      data: { questionText: "Updated text" },
    });
  });

  it("still clones into a Draft Revision for a Published Question Family member, leaving the live version untouched until Republish", async () => {
    const published = draftQuestion({
      status: "PUBLISHED",
      familyId: "fam1",
      currentDraftRevisionId: null,
      currentDraftRevision: null,
      currentPublishedRevisionId: "r1",
      currentPublishedRevision: baseRevision,
    });
    mocked.question.findUnique.mockResolvedValueOnce(published).mockResolvedValueOnce(published);
    mocked.questionRevision.create.mockResolvedValue({ id: "r2" });
    mocked.question.update.mockResolvedValue({});
    mocked.questionFamily.update.mockResolvedValue({});
    mocked.questionRevision.update.mockResolvedValue({});

    await updateDraftContent("q1", { questionText: "Updated text" });

    expect(mocked.questionRevision.create).toHaveBeenCalledTimes(1);
    const cloneCall = mocked.questionRevision.create.mock.calls[0][0].data;
    expect(cloneCall.questionText).toBe(baseRevision.questionText); // clone copies old content verbatim
    expect(mocked.question.update.mock.calls[0][0].data).toMatchObject({
      currentDraftRevisionId: "r2",
      status: "DRAFT_REVISION",
    });
    expect(mocked.questionFamily.update).toHaveBeenCalledWith({
      where: { id: "fam1" },
      data: { status: "DRAFT_REVISION" },
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

    await updateDraftContent("q1", { questionText: "Updated" });

    expect(mocked.questionRevision.update.mock.calls[0][0].data).toMatchObject({ previewCompletedAt: null });
  });

  it("rejects edits to an archived question", async () => {
    mocked.question.findUnique.mockResolvedValue(draftQuestion({ status: "ARCHIVED" }));
    await expect(updateDraftContent("q1", { questionText: "x" })).rejects.toMatchObject({ code: "NOT_DRAFT" });
  });

  it("re-derives calculatorSetting from the question's current category on every save", async () => {
    // Fixture's baseRevision hardcodes calculatorSetting: "NOT_ALLOWED", but
    // draftQuestion()'s category defaults to ALGEBRA — a save should correct
    // the mismatch rather than leave stale data in place.
    const draft = draftQuestion();
    mocked.question.findUnique.mockResolvedValueOnce(draft).mockResolvedValueOnce(draft);
    mocked.questionRevision.update.mockResolvedValue({});

    await updateDraftContent("q1", { questionText: "Edited" });

    expect(mocked.questionRevision.update.mock.calls[0][0].data).toMatchObject({ calculatorSetting: "ALLOWED" });
  });

  it("re-derives calculatorSetting from an incoming category patch, not the old category", async () => {
    const draft = draftQuestion({ category: "ALGEBRA" });
    mocked.question.findUnique.mockResolvedValueOnce(draft).mockResolvedValueOnce(draft);
    mocked.questionRevision.update.mockResolvedValue({});
    mocked.question.update.mockResolvedValue({});

    await updateDraftContent("q1", { category: "GRAMMAR" });

    expect(mocked.questionRevision.update.mock.calls[0][0].data).toMatchObject({ calculatorSetting: "NOT_ALLOWED" });
  });

  it("re-derives suggestedTimeSeconds from the question's current difficulty on every save", async () => {
    // Fixture's baseRevision hardcodes suggestedTimeSeconds: 60, but
    // draftQuestion()'s difficulty defaults to MEDIUM (90s) — a save should
    // correct the mismatch rather than leave stale data in place.
    const draft = draftQuestion();
    mocked.question.findUnique.mockResolvedValueOnce(draft).mockResolvedValueOnce(draft);
    mocked.questionRevision.update.mockResolvedValue({});

    await updateDraftContent("q1", { questionText: "Edited" });

    expect(mocked.questionRevision.update.mock.calls[0][0].data).toMatchObject({ suggestedTimeSeconds: 90 });
  });

  it("re-derives suggestedTimeSeconds from an incoming difficulty patch, not the old difficulty", async () => {
    const draft = draftQuestion({ difficulty: "MEDIUM" });
    mocked.question.findUnique.mockResolvedValueOnce(draft).mockResolvedValueOnce(draft);
    mocked.questionRevision.update.mockResolvedValue({});
    mocked.question.update.mockResolvedValue({});

    await updateDraftContent("q1", { difficulty: "HARD" });

    expect(mocked.questionRevision.update.mock.calls[0][0].data).toMatchObject({ suggestedTimeSeconds: 180 });
  });

  it("forces distractorExplanation to null for the correct choice even if the caller passed one", async () => {
    const draft = draftQuestion();
    mocked.question.findUnique.mockResolvedValueOnce(draft).mockResolvedValueOnce(draft);
    mocked.questionRevision.update.mockResolvedValue({});

    await updateDraftContent("q1", {
      answerChoices: [
        { text: "A", isCorrect: true, imageId: null, distractorExplanation: "should be dropped" },
        { text: "B", isCorrect: false, imageId: null, distractorExplanation: "a real mistake note" },
        { text: "C", isCorrect: false, imageId: null },
        { text: "D", isCorrect: false, imageId: null, distractorExplanation: null },
      ],
    });

    const written = mocked.questionAnswerChoice.upsert.mock.calls.map((call) => call[0].update);
    expect(written.map((c: { distractorExplanation: string | null }) => c.distractorExplanation)).toEqual([
      null,
      "a real mistake note",
      null,
      null,
    ]);
  });
});

describe("updateDraftContent — answer choices keep their ids", () => {
  const fourChoices = [
    { text: "A", isCorrect: false, imageId: null },
    { text: "B (typo fixed)", isCorrect: true, imageId: null },
    { text: "C", isCorrect: false, imageId: null },
    { text: "D", isCorrect: false, imageId: null },
  ];

  it("updates each choice in place by position instead of deleting and recreating the set", async () => {
    // Answers are stored and graded by choice id, so a new id per save would
    // regrade in-flight answers and orphan historical ones.
    const draft = draftQuestion();
    mocked.question.findUnique.mockResolvedValueOnce(draft).mockResolvedValueOnce(draft);
    mocked.questionRevision.update.mockResolvedValue({});

    await updateDraftContent("q1", { answerChoices: fourChoices });

    expect(mocked.questionAnswerChoice.createMany).not.toHaveBeenCalled();
    expect(mocked.questionAnswerChoice.upsert).toHaveBeenCalledTimes(4);
    expect(mocked.questionAnswerChoice.upsert.mock.calls.map((call) => call[0].where)).toEqual(
      [0, 1, 2, 3].map((order) => ({ revisionId_order: { revisionId: "r1", order } })),
    );
    expect(mocked.questionAnswerChoice.upsert.mock.calls[1][0].update).toMatchObject({ text: "B (typo fixed)", isCorrect: true });
    // Only positions past the new set are ever removed — none, for four.
    expect(mocked.questionAnswerChoice.deleteMany).toHaveBeenCalledWith({ where: { revisionId: "r1", order: { gte: 4 } } });
  });

  it("creates a choice for a position that has none yet", async () => {
    const draft = draftQuestion();
    mocked.question.findUnique.mockResolvedValueOnce(draft).mockResolvedValueOnce(draft);
    mocked.questionRevision.update.mockResolvedValue({});

    await updateDraftContent("q1", { answerChoices: fourChoices });

    expect(mocked.questionAnswerChoice.upsert.mock.calls[2][0].create).toEqual({
      revisionId: "r1",
      order: 2,
      text: "C",
      isCorrect: false,
      imageId: null,
      distractorExplanation: null,
    });
  });

  it("refuses anything other than four choices before writing any of them", async () => {
    const draft = draftQuestion();
    mocked.question.findUnique.mockResolvedValueOnce(draft);
    mocked.questionRevision.update.mockResolvedValue({});

    await expect(updateDraftContent("q1", { answerChoices: fourChoices.slice(0, 3) })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(mocked.questionAnswerChoice.upsert).not.toHaveBeenCalled();
  });
});

describe("updateDraftContent — a live edit can't make the question unpublishable", () => {
  function published(revision: Omit<typeof baseRevision, "writtenExplanation"> & { writtenExplanation: string | null }) {
    return draftQuestion({
      status: "PUBLISHED",
      currentDraftRevisionId: null,
      currentDraftRevision: null,
      currentPublishedRevisionId: "r1",
      currentPublishedRevision: revision,
    });
  }
  const emptiedChoice = {
    ...baseRevision,
    answerChoices: baseRevision.answerChoices.map((c) => (c.order === 2 ? { ...c, text: "" } : c)),
  };

  it("refuses, naming what to fix, when the save would leave a live question unanswerable", async () => {
    // The re-read inside the transaction is what the edit produced; the throw
    // rolls the whole transaction back.
    mocked.question.findUnique.mockResolvedValueOnce(published(baseRevision)).mockResolvedValueOnce(published(emptiedChoice));
    mocked.questionRevision.update.mockResolvedValue({});

    const save = updateDraftContent("q1", {
      answerChoices: emptiedChoice.answerChoices.map((c) => ({ text: c.text, isCorrect: c.isCorrect, imageId: null })),
    });

    await expect(save).rejects.toMatchObject({ code: "PUBLISH_VALIDATION_FAILED" });
    await expect(save).rejects.toThrow(/live.*Every answer choice needs text/);
  });

  it("allows the same half-finished state on a Draft, which no student can be served", async () => {
    const draft = draftQuestion();
    mocked.question.findUnique.mockResolvedValueOnce(draft).mockResolvedValueOnce(draftQuestion({ currentDraftRevision: emptiedChoice }));
    mocked.questionRevision.update.mockResolvedValue({});

    await expect(updateDraftContent("q1", { questionText: "Edited" })).resolves.toMatchObject({ id: "q1" });
  });

  it("still lets an already-short live question be fixed one field at a time", async () => {
    // Content from before a checklist rule existed: the edit doesn't make it
    // worse, so it isn't the edit's job to make it whole.
    const alreadyShort = { ...baseRevision, questionText: "" };
    mocked.question.findUnique
      .mockResolvedValueOnce(published(alreadyShort))
      .mockResolvedValueOnce(published({ ...alreadyShort, writtenExplanation: "Because 2 + 2 = 4." }));
    mocked.questionRevision.update.mockResolvedValue({});

    await expect(updateDraftContent("q1", { writtenExplanation: "Because 2 + 2 = 4." })).resolves.toBeTruthy();
  });

  it("returns the question as the transaction left it", async () => {
    const after = published({ ...baseRevision, questionText: "Updated text" });
    mocked.question.findUnique.mockResolvedValueOnce(published(baseRevision)).mockResolvedValueOnce(after);
    mocked.questionRevision.update.mockResolvedValue({});

    expect(await updateDraftContent("q1", { questionText: "Updated text" })).toBe(after);
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
