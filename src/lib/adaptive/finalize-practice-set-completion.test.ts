import { beforeEach, describe, expect, it, vi } from "vitest";
import { finalizePracticeSetCompletion } from "@/lib/adaptive/finalize-practice-set-completion";
import { completePracticeSet } from "@/lib/adaptive/complete-practice-set";
import { generatePracticeSet } from "@/lib/adaptive/generate-practice-set";
import { generateAdaptivePrediction } from "@/lib/score/generate-adaptive-prediction";

vi.mock("@/lib/adaptive/complete-practice-set", () => ({ completePracticeSet: vi.fn() }));
vi.mock("@/lib/adaptive/generate-practice-set", () => ({ generatePracticeSet: vi.fn() }));
vi.mock("@/lib/score/generate-adaptive-prediction", () => ({ generateAdaptivePrediction: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(completePracticeSet).mockResolvedValue({ id: "set1", status: "COMPLETED" } as never);
  vi.mocked(generateAdaptivePrediction).mockResolvedValue({ id: "pred1" } as never);
  vi.mocked(generatePracticeSet).mockResolvedValue({ id: "set2" } as never);
});

describe("finalizePracticeSetCompletion", () => {
  it("always completes with confirmBlanks false — no student-facing bypass for unanswered questions", async () => {
    await finalizePracticeSetCompletion("student1", "set1");

    expect(completePracticeSet).toHaveBeenCalledWith("student1", "set1", { confirmBlanks: false });
  });

  it("propagates BLANKS_REMAIN so the caller can redirect the student back to unanswered questions", async () => {
    vi.mocked(completePracticeSet).mockRejectedValue(new Error("BLANKS_REMAIN"));

    await expect(finalizePracticeSetCompletion("student1", "set1")).rejects.toThrow("BLANKS_REMAIN");
    expect(generateAdaptivePrediction).not.toHaveBeenCalled();
  });

  it("does not let a next-set pre-generation failure block completion", async () => {
    vi.mocked(generatePracticeSet).mockRejectedValue(new Error("no content"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await finalizePracticeSetCompletion("student1", "set1");

    expect(result.set).toEqual({ id: "set1", status: "COMPLETED" });
    expect(result.prediction).toEqual({ id: "pred1" });
  });
});
