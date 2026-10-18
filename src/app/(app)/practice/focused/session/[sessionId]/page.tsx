import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { hasPaidAccess } from "@/lib/entitlements";
import {
  getStudentQuestionContent,
  getStudentQuestionFeedback,
} from "@/lib/session/question-content";
import { FOCUSED_CATEGORY_LABELS, FOCUSED_DIFFICULTY_LABELS } from "@/lib/focused/config";
import { getFocusedSessionForRunner } from "@/lib/focused/sessions";
import { FocusedRunner } from "./focused-runner";

// The Focused Practice question flow — the same SessionRunner the Diagnostic,
// Practice Sessions and 800 Club use, so a drilled question looks and behaves
// exactly like any other question.
export default async function FocusedSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");
  const studentId = session.user.id;
  if (!(await hasPaidAccess(studentId))) redirect("/practice/focused");

  const { sessionId } = await params;
  const focused = await getFocusedSessionForRunner(studentId, sessionId);
  if (!focused) redirect("/practice/focused");
  if (focused.status === "COMPLETED") redirect(`/practice/focused/results/${focused.id}`);

  const items = focused.slots.map((s) => ({
    id: s.id,
    position: s.position,
    submitted: s.finalizedAt !== null,
    studentAnswer: s.answer,
    isCorrect: s.isCorrect,
    draftAnswer: s.draftAnswer,
    skipped: s.skipped,
  }));

  const currentPosition = Math.min(focused.currentPosition, items.length - 1);
  const currentSlot = focused.slots[currentPosition];
  const content = await getStudentQuestionContent(currentSlot.questionRevisionId);
  const feedback = currentSlot.finalizedAt
    ? await getStudentQuestionFeedback(currentSlot.questionRevisionId)
    : null;

  return (
    <FocusedRunner
      studentName={session.user.name ?? undefined}
      sessionId={focused.id}
      title={`${FOCUSED_CATEGORY_LABELS[focused.category]} · ${FOCUSED_DIFFICULTY_LABELS[focused.difficulty]}`}
      items={items}
      initialPosition={currentPosition}
      initialQuestion={{ content, feedback }}
    />
  );
}
