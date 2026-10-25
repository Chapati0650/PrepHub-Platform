import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getStudentQuestionContent, getStudentQuestionFeedback } from "@/lib/session/question-content";
import { getHomeworkSessionForRunner } from "@/lib/teacher/homework";
import { HomeworkRunner } from "./homework-runner";

// The homework question flow — the same SessionRunner every other set uses,
// so a homework question looks and behaves exactly like practice. Focus mode
// (app-shell's FOCUS_MODE_PREFIXES).
export default async function HomeworkSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "STUDENT") redirect("/home");

  const { sessionId } = await params;
  const homework = await getHomeworkSessionForRunner(session.user.id, sessionId);
  if (!homework) redirect("/homework");
  if (homework.status === "COMPLETED") redirect(`/homework/results/${homework.id}`);
  if (homework.slots.length === 0) redirect("/homework");

  const items = homework.slots.map((s) => ({
    id: s.id,
    position: s.position,
    submitted: s.finalizedAt !== null,
    studentAnswer: s.answer,
    isCorrect: s.isCorrect,
    draftAnswer: s.draftAnswer,
    skipped: s.skipped,
  }));

  const currentPosition = Math.min(homework.currentPosition, items.length - 1);
  const currentSlot = homework.slots[currentPosition];
  const [content, feedback] = await Promise.all([
    getStudentQuestionContent(currentSlot.questionRevisionId),
    currentSlot.finalizedAt ? getStudentQuestionFeedback(currentSlot.questionRevisionId) : Promise.resolve(null),
  ]);

  return (
    <HomeworkRunner
      studentName={session.user.name ?? undefined}
      sessionId={homework.id}
      title={homework.assignment.title}
      items={items}
      initialPosition={currentPosition}
      initialQuestion={{ content, feedback }}
    />
  );
}
