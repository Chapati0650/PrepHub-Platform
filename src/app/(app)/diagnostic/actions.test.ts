import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { finalizeDiagnosticAttempt } from "@/lib/diagnostic/finalize-attempt";
import { finalizeDiagnosticCompletion } from "@/lib/diagnostic/complete-diagnostic";
import { advanceDiagnostic } from "@/lib/diagnostic/stages";
import { DiagnosticError } from "@/lib/diagnostic/errors";
import { getStudentQuestionContent } from "@/lib/session/question-content";
import { isSessionBlocked } from "@/lib/session/blocked";
import { completeDiagnosticAction, loadDiagnosticQuestionDetailAction, submitDiagnosticAnswerAction } from "./actions";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { diagnosticAttempt: { findUnique: vi.fn() }, diagnosticSession: { findUnique: vi.fn() } },
}));
vi.mock("@/lib/diagnostic/start-diagnostic", () => ({ startOrResumeDiagnostic: vi.fn() }));
vi.mock("@/lib/diagnostic/finalize-attempt", () => ({ finalizeDiagnosticAttempt: vi.fn() }));
vi.mock("@/lib/diagnostic/save-draft", () => ({ saveDiagnosticDraft: vi.fn(), saveDiagnosticPosition: vi.fn() }));
vi.mock("@/lib/diagnostic/complete-diagnostic", () => ({ finalizeDiagnosticCompletion: vi.fn() }));
vi.mock("@/lib/diagnostic/stages", () => ({ advanceDiagnostic: vi.fn() }));
vi.mock("@/lib/session/question-content", () => ({
  getStudentQuestionContent: vi.fn().mockResolvedValue({ questionText: "Q" }),
  getStudentQuestionFeedback: vi.fn().mockResolvedValue({ correctChoiceId: "b" }),
}));
vi.mock("@/lib/analytics/track", () => ({ track: vi.fn(), FUNNEL_EVENTS: {} }));
vi.mock("@/lib/logger", () => ({ logUnauthorizedAccess: vi.fn() }));

const findSession = prisma.diagnosticSession.findUnique as unknown as ReturnType<typeof vi.fn>;
const findAttempt = prisma.diagnosticAttempt.findUnique as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "student1", role: "STUDENT" } } as never);
});

describe("diagnostic actions — finished in another tab", () => {
  it("answering says the Diagnostic is done and points to the results, rather than throwing", async () => {
    vi.mocked(finalizeDiagnosticAttempt).mockRejectedValue(new DiagnosticError("ALREADY_COMPLETED", "done"));

    const result = await submitDiagnosticAnswerAction("attempt1", "b");

    expect(isSessionBlocked(result)).toBe(true);
    expect(result).toMatchObject({ blocked: { href: "/diagnostic/results" } });
  });

  it("other failures still throw", async () => {
    vi.mocked(finalizeDiagnosticAttempt).mockRejectedValue(new Error("connection reset"));

    await expect(submitDiagnosticAnswerAction("attempt1", "b")).rejects.toThrow("connection reset");
  });

  it("finishing goes straight to the results without completing a second time", async () => {
    findSession.mockResolvedValue({ status: "COMPLETED" });

    const result = await completeDiagnosticAction();

    expect(result).toEqual({ ok: true, redirectTo: "/diagnostic/results" });
    expect(advanceDiagnostic).not.toHaveBeenCalled();
    expect(finalizeDiagnosticCompletion).not.toHaveBeenCalled();
  });
});

describe("diagnostic actions — the review", () => {
  it("won't show a bonus question the student never earned", async () => {
    findAttempt.mockResolvedValue({
      id: "attempt1",
      questionRevisionId: "rev1",
      waivedAt: new Date(),
      answer: null,
      diagnosticSession: { studentId: "student1", status: "COMPLETED" },
    });

    await expect(loadDiagnosticQuestionDetailAction("attempt1")).rejects.toThrow(/not found/i);
    expect(getStudentQuestionContent).not.toHaveBeenCalled();
  });
});
