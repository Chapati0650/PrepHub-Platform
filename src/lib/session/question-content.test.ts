import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStudentQuestionContent, getStudentQuestionFeedback } from "@/lib/session/question-content";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => {
  const mockPrisma: Record<string, unknown> = { questionRevision: { findUniqueOrThrow: vi.fn() } };
  return { prisma: mockPrisma };
});

const mocked = prisma as unknown as { questionRevision: Record<string, ReturnType<typeof vi.fn>> };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getStudentQuestionContent", () => {
  it("never includes which answer choice is correct", async () => {
    mocked.questionRevision.findUniqueOrThrow.mockResolvedValue({
      id: "r1",
      questionText: "2+2=?",
      questionImageId: null,
      calculatorSetting: "NOT_ALLOWED",
      suggestedTimeSeconds: 60,
      question: { questionType: "MULTIPLE_CHOICE" },
      answerChoices: [
        { id: "c1", text: "3", imageId: null, isCorrect: false },
        { id: "c2", text: "4", imageId: null, isCorrect: true },
      ],
    });

    const result = await getStudentQuestionContent("r1");

    expect(result.answerChoices).toEqual([
      { id: "c1", text: "3", imageId: null },
      { id: "c2", text: "4", imageId: null },
    ]);
    expect(JSON.stringify(result)).not.toContain("isCorrect");
  });
});

describe("getStudentQuestionFeedback", () => {
  it("prefers the Question Family's shared video over a standalone video", async () => {
    mocked.questionRevision.findUniqueOrThrow.mockResolvedValue({
      answerChoices: [{ id: "c1", isCorrect: true }],
      acceptedAnswers: [],
      writtenExplanation: "Because math.",
      standaloneVideo: { id: "standalone-video", status: "READY" },
      question: { family: { sharedVideo: { id: "family-video", status: "READY" } } },
    });

    const result = await getStudentQuestionFeedback("r1");

    expect(result.explanationVideoId).toBe("family-video");
  });

  it("falls back to the standalone video when there is no family", async () => {
    mocked.questionRevision.findUniqueOrThrow.mockResolvedValue({
      answerChoices: [{ id: "c1", isCorrect: true }],
      acceptedAnswers: [],
      writtenExplanation: null,
      standaloneVideo: { id: "standalone-video", status: "READY" },
      question: { family: null },
    });

    const result = await getStudentQuestionFeedback("r1");

    expect(result.explanationVideoId).toBe("standalone-video");
  });

  it("omits the video entirely when it is not READY", async () => {
    mocked.questionRevision.findUniqueOrThrow.mockResolvedValue({
      answerChoices: [{ id: "c1", isCorrect: true }],
      acceptedAnswers: [],
      writtenExplanation: null,
      standaloneVideo: { id: "standalone-video", status: "PROCESSING" },
      question: { family: null },
    });

    const result = await getStudentQuestionFeedback("r1");

    expect(result.explanationVideoId).toBeNull();
  });

  it("returns the correct choice id for multiple choice questions", async () => {
    mocked.questionRevision.findUniqueOrThrow.mockResolvedValue({
      answerChoices: [
        { id: "c1", isCorrect: false },
        { id: "c2", isCorrect: true },
      ],
      acceptedAnswers: [],
      writtenExplanation: null,
      standaloneVideo: null,
      question: { family: null },
    });

    const result = await getStudentQuestionFeedback("r1");

    expect(result.correctChoiceId).toBe("c2");
  });
});
