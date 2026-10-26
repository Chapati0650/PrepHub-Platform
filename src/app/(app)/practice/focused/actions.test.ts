import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPaidAccess } from "@/lib/entitlements";
import { finalizeFocusedAnswer } from "@/lib/focused/sessions";
import { FocusedError } from "@/lib/focused/errors";
import { isSessionBlocked } from "@/lib/session/blocked";
import { submitFocusedAnswerAction } from "./actions";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { focusedSlot: { findUnique: vi.fn() } } }));
vi.mock("@/lib/entitlements", () => ({ hasPaidAccess: vi.fn() }));
vi.mock("@/lib/focused/sessions", () => ({
  completeFocusedSession: vi.fn(),
  finalizeFocusedAnswer: vi.fn(),
  openFocusedSession: vi.fn(),
}));
vi.mock("@/lib/session/question-content", () => ({
  getStudentQuestionContent: vi.fn(),
  getStudentQuestionFeedback: vi.fn().mockResolvedValue({ correctChoiceId: "b" }),
}));
vi.mock("@/lib/logger", () => ({ logUnauthorizedAccess: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "student1", role: "STUDENT" } } as never);
  (prisma.focusedSlot.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "slot1",
    sessionId: "session1",
    questionRevisionId: "rev1",
    session: { studentId: "student1" },
  });
});

describe("submitFocusedAnswerAction", () => {
  it("checks Premium on every answer, and says so as data when it has ended", async () => {
    vi.mocked(hasPaidAccess).mockResolvedValue(false);

    const result = await submitFocusedAnswerAction("slot1", "b");

    expect(isSessionBlocked(result)).toBe(true);
    expect(result).toMatchObject({ blocked: { href: "/pricing" } });
    expect(finalizeFocusedAnswer).not.toHaveBeenCalled();
  });

  it("points to the results when the session was finished in another tab", async () => {
    vi.mocked(hasPaidAccess).mockResolvedValue(true);
    vi.mocked(finalizeFocusedAnswer).mockRejectedValue(new FocusedError("SESSION_COMPLETED", "done"));

    const result = await submitFocusedAnswerAction("slot1", "b");

    expect(result).toMatchObject({ blocked: { href: "/practice/focused/results/session1" } });
  });
});
