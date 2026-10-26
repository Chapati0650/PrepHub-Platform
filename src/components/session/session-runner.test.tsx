import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionBlocked } from "@/lib/session/blocked";
import { STALE_BUILD_MESSAGE } from "@/lib/stale-build";
import type { StudentQuestionFeedback } from "@/lib/session/question-content";
import { SessionRunner, type LoadedQuestion, type SessionRunnerItem, type SessionRunnerProps } from "./session-runner";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
// The children that need a browser or a router are beside the point here.
vi.mock("@/components/ui/link-button", () => ({
  LinkButton: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/content/latex-text", () => ({ LatexText: ({ text }: { text: string }) => <>{text}</> }));
vi.mock("@/components/content/question-statement", () => ({
  QuestionStatement: ({ text }: { text: string }) => <p>{text}</p>,
}));
vi.mock("@/components/content/explanation-steps", () => ({ ExplanationSteps: () => null }));
vi.mock("@/components/content/distractor-note", () => ({ DistractorNote: () => null }));
vi.mock("./annotator", () => ({ Annotator: () => null, highlightsSupported: () => false }));
vi.mock("./timer-badge", () => ({ TimerBadge: () => null }));

const FEEDBACK: StudentQuestionFeedback = {
  correctChoiceId: "b",
  acceptedAnswers: ["12"],
  writtenExplanation: null,
  explanationSteps: [],
  explanationVideoId: null,
  distractorExplanationsByChoiceId: {},
};

function question(type: "MULTIPLE_CHOICE" | "OPEN_ENDED_NUMERIC", id = "q"): LoadedQuestion {
  return {
    content: {
      questionRevisionId: `${id}-rev`,
      questionType: type,
      questionText: `Question ${id}`,
      passageText: null,
      questionImageId: null,
      calculatorSetting: "NOT_ALLOWED",
      suggestedTimeSeconds: 60,
      answerChoices:
        type === "MULTIPLE_CHOICE"
          ? [
              { id: "a", text: "Alpha", imageId: null },
              { id: "b", text: "Bravo", imageId: null },
              { id: "c", text: "Charlie", imageId: null },
            ]
          : [],
    },
    feedback: null,
  };
}

function item(id: string, position: number): SessionRunnerItem {
  return { id, position, submitted: false, studentAnswer: null, isCorrect: null, draftAnswer: null, skipped: false };
}

function renderRunner(overrides: Partial<SessionRunnerProps> = {}, type: "MULTIPLE_CHOICE" | "OPEN_ENDED_NUMERIC" = "MULTIPLE_CHOICE") {
  const props: SessionRunnerProps = {
    title: "Practice Set 2",
    initialItems: [item("one", 0), item("two", 1)],
    initialPosition: 0,
    initialQuestion: question(type, "one"),
    allowBlankConfirmation: false,
    loadQuestion: vi.fn().mockResolvedValue(question("MULTIPLE_CHOICE", "two")),
    saveDraft: vi.fn().mockResolvedValue(undefined),
    savePosition: vi.fn().mockResolvedValue(undefined),
    submitAnswer: vi.fn().mockResolvedValue({ isCorrect: false, studentAnswer: "a", feedback: FEEDBACK }),
    complete: vi.fn().mockResolvedValue({ ok: true, redirectTo: "/done" }),
    ...overrides,
  };
  render(<SessionRunner {...props} />);
  return props;
}

function choice(letter: string) {
  return document.querySelector(`[data-answer-choice="${letter}"]`) as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SessionRunner — a request that fails", () => {
  it("says so beside the controls and retries, instead of staying on Submitting… forever", async () => {
    const submitAnswer = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce({ isCorrect: true, studentAnswer: "b", feedback: FEEDBACK });
    renderRunner({ submitAnswer });

    fireEvent.click(choice("B"));
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));

    expect(await screen.findByText(/couldn't save that answer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit answer" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Correct!")).toBeInTheDocument();
    expect(submitAnswer).toHaveBeenLastCalledWith("one", "b");
    expect(screen.queryByText(/couldn't save that answer/)).not.toBeInTheDocument();
  });

  it("asks for a reload rather than a retry when the page is from before a deploy", async () => {
    renderRunner({
      submitAnswer: vi.fn().mockRejectedValue(new Error('Server Action "abc" was not found on the server.')),
    });

    fireEvent.click(choice("A"));
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));

    expect(await screen.findByText(STALE_BUILD_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("offers Try again when the next question fails to load, rather than Loading question… forever", async () => {
    const loadQuestion = vi
      .fn()
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce(question("MULTIPLE_CHOICE", "two"));
    renderRunner({ loadQuestion });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText(/couldn't load this question/)).toBeInTheDocument();
    expect(screen.queryByText("Loading question…")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Question two")).toBeInTheDocument();
  });
});

describe("SessionRunner — a session that can't go on", () => {
  it("shows the reason and the way forward, and stops taking answers", async () => {
    renderRunner({
      submitAnswer: vi
        .fn()
        .mockResolvedValue(sessionBlocked("Your Premium access has ended.", "/pricing", "Unlock with Premium")),
    });

    fireEvent.click(choice("A"));
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));

    expect(await screen.findByText("Your Premium access has ended.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Unlock with Premium" })).toHaveAttribute("href", "/pricing");
    expect(screen.queryByRole("button", { name: "Submit answer" })).not.toBeInTheDocument();
    expect(choice("B")).toBeDisabled();
  });

  it("handles a block from finishing the same way", async () => {
    const one = { ...item("one", 0), submitted: true, studentAnswer: "b", isCorrect: true };
    const two = { ...item("two", 1), submitted: true, studentAnswer: "a", isCorrect: false };
    renderRunner({
      initialItems: [one, two],
      complete: vi.fn().mockResolvedValue(sessionBlocked("Your teacher closed this homework.", "/homework", "Back to homework")),
    });

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    expect(await screen.findByText("Your teacher closed this homework.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Finish" })).toBeDisabled();
  });
});

describe("SessionRunner — the answer shown after Submit", () => {
  it("highlights the answer the server recorded, not this tab's pick", async () => {
    // Answered as A in another tab; this tab picked C. The server keeps A.
    renderRunner({
      submitAnswer: vi.fn().mockResolvedValue({ isCorrect: false, studentAnswer: "a", feedback: FEEDBACK }),
    });

    fireEvent.click(choice("C"));
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));

    expect(await screen.findByText("Incorrect.")).toBeInTheDocument();
    expect(choice("A")).toHaveAttribute("aria-pressed", "true");
    expect(choice("C")).toHaveAttribute("aria-pressed", "false");
  });

  it("says which choice is which in words, announces the result and moves focus to it", async () => {
    renderRunner();

    fireEvent.click(choice("A"));
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));

    const result = await screen.findByRole("status");
    expect(result).toHaveTextContent("Incorrect.");
    expect(result).toHaveFocus();
    expect(choice("A")).toHaveTextContent("Your answer");
    expect(choice("B")).toHaveTextContent("Correct answer");
    expect(choice("C").textContent).toBe("CCharlie");
  });
});

describe("SessionRunner — draft autosave", () => {
  it("waits for typing to stop and sends only the latest value", async () => {
    vi.useFakeTimers();
    const { saveDraft } = renderRunner({}, "OPEN_ENDED_NUMERIC");
    const input = screen.getByLabelText("Your answer");

    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.change(input, { target: { value: "123" } });
    expect(saveDraft).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledWith("one", { draftAnswer: "123", skipped: false });
  });

  it("doesn't send a value the server already has", async () => {
    vi.useFakeTimers();
    const { saveDraft } = renderRunner(
      { initialItems: [{ ...item("one", 0), draftAnswer: "12" }, item("two", 1)] },
      "OPEN_ENDED_NUMERIC",
    );
    const input = screen.getByLabelText("Your answer");

    fireEvent.change(input, { target: { value: "123" } });
    fireEvent.change(input, { target: { value: "12" } });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("sends a draft still waiting before moving to another question, so a reload finds it", async () => {
    const { saveDraft, savePosition } = renderRunner({}, "OPEN_ENDED_NUMERIC");

    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(saveDraft).toHaveBeenCalledWith("one", { draftAnswer: "42", skipped: false });
    await waitFor(() => expect(savePosition).toHaveBeenCalledWith(1));
    expect((saveDraft as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
      (savePosition as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    );
  });

  it("drops a waiting draft on Submit, so nothing queues ahead of the answer", async () => {
    vi.useFakeTimers();
    const { saveDraft, submitAnswer } = renderRunner();

    fireEvent.click(choice("B"));
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(submitAnswer).toHaveBeenCalledWith("one", "b");
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("retries a failed draft save once, and doesn't leave an unhandled rejection", async () => {
    vi.useFakeTimers();
    const saveDraft = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    renderRunner({ saveDraft }, "OPEN_ENDED_NUMERIC");

    fireEvent.change(screen.getByLabelText("Your answer"), { target: { value: "7" } });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(saveDraft).toHaveBeenCalledTimes(2);
  });
});
