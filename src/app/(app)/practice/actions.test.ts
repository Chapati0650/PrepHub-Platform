import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canOpenPracticeSet } from "@/lib/practice/free-tier";
import { finalizeAnswer } from "@/lib/adaptive/finalize-answer";
import { getStudentQuestionContent } from "@/lib/session/question-content";
import { isSessionBlocked } from "@/lib/session/blocked";
import { loadPracticeQuestionAction, loadPracticeQuestionDetailAction, submitPracticeAnswerAction } from "./actions";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { blueprintSlot: { findUnique: vi.fn(), updateMany: vi.fn() } } }));
vi.mock("@/lib/practice/free-tier", () => ({ canOpenPracticeSet: vi.fn() }));
vi.mock("@/lib/adaptive/finalize-answer", () => ({ finalizeAnswer: vi.fn() }));
vi.mock("@/lib/adaptive/finalize-practice-set-completion", () => ({ finalizePracticeSetCompletion: vi.fn() }));
vi.mock("@/lib/session/question-content", () => ({
  getStudentQuestionContent: vi.fn().mockResolvedValue({ questionText: "Q" }),
  getStudentQuestionFeedback: vi.fn().mockResolvedValue({ correctChoiceId: "b" }),
}));
vi.mock("@/lib/logger", () => ({ logUnauthorizedAccess: vi.fn() }));

const findSlot = prisma.blueprintSlot.findUnique as unknown as ReturnType<typeof vi.fn>;

function slot(setNumber: number, status: "ACTIVE" | "COMPLETED" = "ACTIVE") {
  return {
    id: "slot1",
    questionRevisionId: "rev1",
    practiceSet: { studentId: "student1", setNumber, status },
    finalizedAttempt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "student1", role: "STUDENT" } } as never);
});

describe("practice actions — a set behind the paywall", () => {
  it("tells the student their Premium ended, as data the runner can show, instead of throwing", async () => {
    findSlot.mockResolvedValue(slot(2));
    vi.mocked(canOpenPracticeSet).mockResolvedValue(false);

    const result = await submitPracticeAnswerAction("slot1", "b");

    expect(isSessionBlocked(result)).toBe(true);
    expect(result).toMatchObject({ blocked: { href: "/pricing" } });
    expect(finalizeAnswer).not.toHaveBeenCalled();
  });

  it("won't hand out a locked set's questions by slot id", async () => {
    findSlot.mockResolvedValue(slot(2));
    vi.mocked(canOpenPracticeSet).mockResolvedValue(false);

    const result = await loadPracticeQuestionAction("slot1");

    expect(isSessionBlocked(result)).toBe(true);
    expect(getStudentQuestionContent).not.toHaveBeenCalled();
  });

  it("still lets a student review a set they finished while they had Premium", async () => {
    findSlot.mockResolvedValue(slot(2, "COMPLETED"));
    vi.mocked(canOpenPracticeSet).mockResolvedValue(false);

    const result = await loadPracticeQuestionDetailAction("slot1");

    expect(result.content).toEqual({ questionText: "Q" });
  });

  it("refuses the review detail of an unfinished locked set", async () => {
    findSlot.mockResolvedValue(slot(2));
    vi.mocked(canOpenPracticeSet).mockResolvedValue(false);

    await expect(loadPracticeQuestionDetailAction("slot1")).rejects.toThrow(/Premium/);
    expect(getStudentQuestionContent).not.toHaveBeenCalled();
  });

  it("serves and grades an open set as before", async () => {
    findSlot.mockResolvedValue(slot(1));
    vi.mocked(canOpenPracticeSet).mockResolvedValue(true);
    vi.mocked(finalizeAnswer).mockResolvedValue({ isCorrect: true, answer: "b" } as never);

    const result = await submitPracticeAnswerAction("slot1", "b");

    expect(result).toEqual({ isCorrect: true, studentAnswer: "b", feedback: { correctChoiceId: "b" } });
  });
});
