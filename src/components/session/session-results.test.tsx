import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LoadedQuestion } from "./session-runner";
import { QuestionDetail, ReviewDetail, useQuestionReview } from "./session-results";

vi.mock("@/components/ui/link-button", () => ({
  LinkButton: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/content/latex-text", () => ({ LatexText: ({ text }: { text: string }) => <>{text}</> }));
vi.mock("@/components/content/question-statement", () => ({
  QuestionStatement: ({ text }: { text: string }) => <p>{text}</p>,
}));
vi.mock("@/components/content/explanation-steps", () => ({ ExplanationSteps: () => null }));

const LOADED: LoadedQuestion = {
  content: {
    questionRevisionId: "rev",
    questionType: "MULTIPLE_CHOICE",
    questionText: "Which one?",
    passageText: null,
    questionImageId: null,
    calculatorSetting: "NOT_ALLOWED",
    suggestedTimeSeconds: 60,
    answerChoices: [
      { id: "a", text: "Alpha", imageId: null },
      { id: "b", text: "Bravo", imageId: null },
    ],
  },
  feedback: {
    correctChoiceId: "b",
    acceptedAnswers: [],
    writtenExplanation: null,
    explanationSteps: [],
    explanationVideoId: null,
    distractorExplanationsByChoiceId: {},
    walkthrough: null,
  },
  studentAnswer: "a",
};

function Harness({ load }: { load: (id: string) => Promise<LoadedQuestion> }) {
  const review = useQuestionReview(load);
  return (
    <>
      <button type="button" onClick={() => review.toggle("q1")}>
        Question 1
      </button>
      {review.expandedId === "q1" && <ReviewDetail review={review} id="q1" isCorrect={false} />}
    </>
  );
}

describe("the results review", () => {
  it("says a question failed to load and retries it, instead of Loading… forever", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValueOnce(LOADED);
    render(<Harness load={load} />);

    fireEvent.click(screen.getByRole("button", { name: "Question 1" }));
    expect(await screen.findByText(/couldn't load this question/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Which one?")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("names the student's answer and the correct one in words, not colour alone", () => {
    render(<QuestionDetail loaded={LOADED} isCorrect={false} />);

    expect(screen.getByText("Alpha").closest("div")).toHaveTextContent("Your answer");
    expect(screen.getByText("Bravo").closest("div")).toHaveTextContent("Correct answer");
  });

  it("says why a wrong answer is wrong under that answer, and shows the passage", () => {
    const loaded: LoadedQuestion = {
      ...LOADED,
      content: { ...LOADED.content, passageText: "The text the question asks about." },
      feedback: { ...LOADED.feedback!, distractorExplanationsByChoiceId: { a: "Alpha confuses the two values." } },
    };
    render(<QuestionDetail loaded={loaded} isCorrect={false} />);

    expect(screen.getByText("The text the question asks about.")).toBeInTheDocument();
    const note = screen.getByText("Alpha confuses the two values.");
    // In the same group as the choice it explains, not in a box after the list.
    expect(note.closest(".flex-col")).toHaveTextContent("Alpha");
    expect(note.closest("p")).toHaveTextContent("Why it's wrong");
  });
});
