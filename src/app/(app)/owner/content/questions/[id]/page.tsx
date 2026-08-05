import { notFound } from "next/navigation";
import { getQuestionOrThrow } from "@/lib/content/questions";
import { ContentError } from "@/lib/content/errors";
import { QuestionEditor } from "./question-editor";

export default async function QuestionEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const question = await getQuestionOrThrow(id).catch((err) => {
    if (err instanceof ContentError && err.code === "QUESTION_NOT_FOUND") return null;
    throw err;
  });
  if (!question) notFound();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
      <QuestionEditor question={question} />
    </div>
  );
}
