import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { hasPaidAccess } from "@/lib/entitlements";
import { getStudentQuestionContent, getStudentQuestionFeedback } from "@/lib/session/question-content";
import { CLUB_SECTIONS } from "@/lib/club/config";
import { getClubSessionForRunner } from "@/lib/club/sessions";
import { ClubRunner } from "./club-runner";

// The 800 Club question flow — the same SessionRunner the Diagnostic and
// Practice Sessions use, so a hard question looks and behaves exactly like
// any other question. Reached only from the 800 Club page's "Open".
export default async function ClubSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");
  const studentId = session.user.id;
  if (!(await hasPaidAccess(studentId))) redirect("/800-club");

  const { sessionId } = await params;
  const club = await getClubSessionForRunner(studentId, sessionId);
  if (!club) redirect("/800-club");
  if (club.status === "COMPLETED") redirect(`/800-club/results/${club.id}`);

  const items = club.slots.map((s) => ({
    id: s.id,
    position: s.position,
    submitted: s.finalizedAt !== null,
    studentAnswer: s.answer,
    isCorrect: s.isCorrect,
    draftAnswer: s.draftAnswer,
    skipped: s.skipped,
  }));

  const currentPosition = Math.min(club.currentPosition, items.length - 1);
  const currentSlot = club.slots[currentPosition];
  const content = await getStudentQuestionContent(currentSlot.questionRevisionId);
  const feedback = currentSlot.finalizedAt ? await getStudentQuestionFeedback(currentSlot.questionRevisionId) : null;

  return (
    <ClubRunner
      sessionId={club.id}
      sectionLabel={CLUB_SECTIONS[club.section].label}
      items={items}
      initialPosition={currentPosition}
      initialQuestion={{ content, feedback }}
    />
  );
}
