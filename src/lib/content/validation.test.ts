import { describe, expect, it } from "vitest";
import { getPublishIssues, type FamilyForValidation, type RevisionForValidation } from "@/lib/content/validation";
import type { MediaAsset, Question, QuestionAnswerChoice } from "@/generated/prisma/client";

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "q1",
    status: "DRAFT",
    questionType: "MULTIPLE_CHOICE",
    category: "ALGEBRA",
    difficulty: "MEDIUM",
    familyId: null,
    currentPublishedRevisionId: null,
    currentDraftRevisionId: "r1",
    createdAt: new Date(),
    updatedAt: new Date(),
    publishedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function makeChoices(overrides?: (Partial<QuestionAnswerChoice> | undefined)[]): QuestionAnswerChoice[] {
  const base: QuestionAnswerChoice[] = [0, 1, 2, 3].map((order) => ({
    id: `c${order}`,
    revisionId: "r1",
    order,
    text: `Choice ${order}`,
    isCorrect: order === 0,
    imageId: null,
  }));
  if (!overrides) return base;
  return base.map((c, i) => ({ ...c, ...(overrides[i] ?? {}) }));
}

function makeVideo(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "v1",
    kind: "VIDEO",
    status: "READY",
    storageKey: "videos/v1.mp4",
    originalFilename: "v1.mp4",
    mimeType: "video/mp4",
    sizeBytes: 100,
    durationSeconds: 60,
    width: null,
    height: null,
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRevision(overrides: Partial<RevisionForValidation> = {}): RevisionForValidation {
  return {
    id: "r1",
    questionId: "q1",
    questionText: "What is 2 + 2?",
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
    answerChoices: makeChoices(),
    standaloneVideo: makeVideo(),
    ...overrides,
  };
}

function makeFamily(overrides: Partial<FamilyForValidation> = {}): FamilyForValidation {
  return {
    id: "f1",
    status: "DRAFT",
    internalName: null,
    category: "ALGEBRA",
    difficulty: "MEDIUM",
    sharedVideoId: "v1",
    createdAt: new Date(),
    updatedAt: new Date(),
    publishedAt: null,
    archivedAt: null,
    sharedVideo: makeVideo(),
    ...overrides,
  };
}

describe("getPublishIssues — standalone multiple choice", () => {
  it("passes a fully valid standalone MC question", () => {
    expect(getPublishIssues(makeQuestion(), makeRevision(), null)).toEqual([]);
  });

  it("flags empty question text", () => {
    const issues = getPublishIssues(makeQuestion(), makeRevision({ questionText: "   " }), null);
    expect(issues).toContain("Question text is required.");
  });

  it("flags a zero suggested time", () => {
    const issues = getPublishIssues(makeQuestion(), makeRevision({ suggestedTimeSeconds: 0 }), null);
    expect(issues).toContain("Suggested time is required.");
  });

  it("flags fewer than four answer choices", () => {
    const issues = getPublishIssues(
      makeQuestion(),
      makeRevision({ answerChoices: makeChoices().slice(0, 3) }),
      null,
    );
    expect(issues.some((i) => i.includes("exactly 4 answer choices"))).toBe(true);
  });

  it("flags a blank answer choice", () => {
    const issues = getPublishIssues(
      makeQuestion(),
      makeRevision({ answerChoices: makeChoices([{ text: "" }]) }),
      null,
    );
    expect(issues).toContain("Every answer choice needs text.");
  });

  it("flags zero correct answers", () => {
    const issues = getPublishIssues(
      makeQuestion(),
      makeRevision({ answerChoices: makeChoices([{ isCorrect: false }]) }),
      null,
    );
    expect(issues).toContain("Exactly one answer choice must be marked correct.");
  });

  it("flags two correct answers", () => {
    const issues = getPublishIssues(
      makeQuestion(),
      makeRevision({ answerChoices: makeChoices([undefined, { isCorrect: true }]) }),
      null,
    );
    expect(issues).toContain("Exactly one answer choice must be marked correct.");
  });
});

describe("getPublishIssues — open-ended numeric", () => {
  it("passes with at least one accepted answer", () => {
    const question = makeQuestion({ questionType: "OPEN_ENDED_NUMERIC" });
    const revision = makeRevision({ acceptedAnswers: ["0.5", ".5", "1/2"] });
    expect(getPublishIssues(question, revision, null)).toEqual([]);
  });

  it("flags an empty accepted-answer list", () => {
    const question = makeQuestion({ questionType: "OPEN_ENDED_NUMERIC" });
    const revision = makeRevision({ acceptedAnswers: [] });
    expect(getPublishIssues(question, revision, null)).toContain("At least one accepted answer is required.");
  });
});

describe("getPublishIssues — video is optional", () => {
  it("does not flag a missing standalone video", () => {
    const issues = getPublishIssues(makeQuestion(), makeRevision({ standaloneVideo: null }), null);
    expect(issues).toEqual([]);
  });

  it("flags a standalone video still processing (broken reference, not a missing one)", () => {
    const issues = getPublishIssues(
      makeQuestion(),
      makeRevision({ standaloneVideo: makeVideo({ status: "PROCESSING" }) }),
      null,
    );
    expect(issues).toContain("The video explanation is still processing or failed to process.");
  });

  it("does not flag a missing family video for a family member", () => {
    const question = makeQuestion({ familyId: "f1" });
    const issues = getPublishIssues(question, makeRevision(), makeFamily({ sharedVideo: null }));
    expect(issues).toEqual([]);
  });

  it("flags a family video that failed processing (broken reference, not a missing one)", () => {
    const question = makeQuestion({ familyId: "f1" });
    const family = makeFamily({ sharedVideo: makeVideo({ status: "FAILED" }) });
    const issues = getPublishIssues(question, makeRevision(), family);
    expect(issues).toContain("The family's shared video is still processing or failed to process.");
  });

  it("does not require a standalone video for a family member", () => {
    const question = makeQuestion({ familyId: "f1" });
    const revision = makeRevision({ standaloneVideo: null });
    const issues = getPublishIssues(question, revision, makeFamily());
    expect(issues).toEqual([]);
  });
});

describe("getPublishIssues — preview and archive", () => {
  it("flags a revision that hasn't been previewed since its latest edit", () => {
    const issues = getPublishIssues(makeQuestion(), makeRevision({ previewCompletedAt: null }), null);
    expect(issues).toContain("Student Preview must be opened for the latest changes before publishing.");
  });

  it("flags an archived question", () => {
    const issues = getPublishIssues(makeQuestion({ status: "ARCHIVED" }), makeRevision(), null);
    expect(issues).toContain("Archived questions cannot be published.");
  });
});
