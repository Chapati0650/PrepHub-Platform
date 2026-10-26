import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPaidAccess } from "@/lib/entitlements";
import { finalizeClubAnswer } from "@/lib/club/sessions";
import { ClubError } from "@/lib/club/errors";
import { isSessionBlocked } from "@/lib/session/blocked";
import { submitClubAnswerAction } from "./actions";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { clubSlot: { findUnique: vi.fn() } } }));
vi.mock("@/lib/entitlements", () => ({ hasPaidAccess: vi.fn() }));
vi.mock("@/lib/club/sessions", () => ({ completeClubSession: vi.fn(), finalizeClubAnswer: vi.fn(), openClubSession: vi.fn() }));
vi.mock("@/lib/session/question-content", () => ({
  getStudentQuestionContent: vi.fn(),
  getStudentQuestionFeedback: vi.fn().mockResolvedValue({ correctChoiceId: "b" }),
}));
vi.mock("@/lib/logger", () => ({ logUnauthorizedAccess: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "student1", role: "STUDENT" } } as never);
  (prisma.clubSlot.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "slot1",
    sessionId: "session1",
    questionRevisionId: "rev1",
    session: { studentId: "student1" },
  });
});

describe("submitClubAnswerAction", () => {
  it("checks Premium on every answer, and says so as data when it has ended", async () => {
    vi.mocked(hasPaidAccess).mockResolvedValue(false);

    const result = await submitClubAnswerAction("slot1", "b");

    expect(isSessionBlocked(result)).toBe(true);
    expect(result).toMatchObject({ blocked: { href: "/pricing" } });
    expect(finalizeClubAnswer).not.toHaveBeenCalled();
  });

  it("points to the results when the session was finished in another tab", async () => {
    vi.mocked(hasPaidAccess).mockResolvedValue(true);
    vi.mocked(finalizeClubAnswer).mockRejectedValue(new ClubError("SESSION_COMPLETED", "done"));

    const result = await submitClubAnswerAction("slot1", "b");

    expect(result).toMatchObject({ blocked: { href: "/800-club/results/session1" } });
  });

  it("grades as before for a Premium student", async () => {
    vi.mocked(hasPaidAccess).mockResolvedValue(true);
    vi.mocked(finalizeClubAnswer).mockResolvedValue({ isCorrect: true, answer: "b" } as never);

    const result = await submitClubAnswerAction("slot1", "b");

    expect(result).toEqual({ isCorrect: true, studentAnswer: "b", feedback: { correctChoiceId: "b" } });
  });
});
