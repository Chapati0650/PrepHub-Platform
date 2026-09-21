import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { canOpenPracticeSet } from "@/lib/practice/free-tier";
import { getStudentQuestionContent, getStudentQuestionFeedback } from "@/lib/session/question-content";
import { PracticeRunner } from "./practice-runner";

// PRD-006 — the active question-by-question Practice Session, reusing the
// same SessionRunner the diagnostic uses. Always reached via the Practice
// entry page (PRD-005 §7): never a direct link into a question.
export default async function PracticeSessionPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");
  const studentId = session.user.id;

  const diagnostic = await prisma.diagnosticSession.findUnique({ where: { studentId } });
  if (diagnostic?.status !== "COMPLETED") redirect("/diagnostic");

  const set = await prisma.practiceSet.findFirst({
    where: { studentId, status: "ACTIVE" },
    include: { slots: { orderBy: { position: "asc" }, include: { finalizedAttempt: true } } },
  });
  if (!set) redirect("/practice");
  // Set 1 is free; later sets need Premium (lib/practice/free-tier.ts).
  if (!(await canOpenPracticeSet(studentId, set.setNumber))) redirect("/practice");

  const items = set.slots.map((s) => ({
    id: s.id,
    position: s.position,
    submitted: s.finalizedAttempt !== null,
    studentAnswer: s.finalizedAttempt?.answer ?? null,
    isCorrect: s.finalizedAttempt?.isCorrect ?? null,
    draftAnswer: s.draftAnswer,
    skipped: s.skipped,
  }));

  const currentPosition = Math.min(set.currentPosition, items.length - 1);
  const currentSlot = set.slots[currentPosition];
  const content = await getStudentQuestionContent(currentSlot.questionRevisionId);
  const feedback = currentSlot.finalizedAttempt ? await getStudentQuestionFeedback(currentSlot.questionRevisionId) : null;

  return (
    <PracticeRunner
      practiceSetId={set.id}
      setNumber={set.setNumber}
      items={items}
      initialPosition={currentPosition}
      initialQuestion={{ content, feedback }}
    />
  );
}
