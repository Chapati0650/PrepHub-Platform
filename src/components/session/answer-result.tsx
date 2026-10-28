import { LatexText } from "@/components/content/latex-text";

// The verdict on an answered question, said in full: which choice the
// student picked and which is right, so the walkthrough that follows starts
// from "you chose A; the answer is C" rather than a bare "Incorrect." Shared
// by the session runner and the review on every results page.

type Answerable = {
  content: { questionType: string; answerChoices: { id: string }[] };
  feedback: { correctChoiceId: string | null; acceptedAnswers: string[] } | null;
};

const letter = (i: number) => String.fromCharCode(65 + i);

/** "You chose A. The answer is C." for a choice; "You entered 5." for a typed answer (the right one is shown beside it). */
export function resultDetail(question: Answerable, answer: string | null | undefined): string {
  if (question.content.questionType === "MULTIPLE_CHOICE") {
    const yours = question.content.answerChoices.findIndex((c) => c.id === answer);
    const right = question.content.answerChoices.findIndex((c) => c.id === question.feedback?.correctChoiceId);
    const said = right === -1 ? "" : `The answer is ${letter(right)}.`;
    return yours === -1 ? said : `You chose ${letter(yours)}. ${said}`.trim();
  }
  return answer?.trim() ? `You entered ${answer.trim()}.` : "";
}

/**
 * The right answer to a typed-in question, in the same green box a correct
 * choice gets, rather than a line of small grey text. Every accepted form is
 * listed ("40/9 or 4.444"), because a student who wrote the other one should
 * see that it counts.
 */
export function AcceptedAnswers({ answers }: { answers: string[] }) {
  if (answers.length === 0) return null;
  return (
    <div className="flex w-fit flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border-2 border-green-600 bg-green-100 px-4 py-2 dark:border-green-500 dark:bg-green-900/50">
      <span className="text-sm font-semibold text-green-800 dark:text-green-300">Correct answer</span>
      <span className="text-lg font-semibold tabular-nums">
        {answers.map((a, i) => (
          <span key={a}>
            {i > 0 && <span className="text-base font-normal text-muted-foreground"> or </span>}
            <LatexText text={a} />
          </span>
        ))}
      </span>
    </div>
  );
}
