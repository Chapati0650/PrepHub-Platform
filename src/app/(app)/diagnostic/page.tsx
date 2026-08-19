import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { getStudentQuestionContent, getStudentQuestionFeedback } from "@/lib/session/question-content";
import { finalizeDiagnosticCompletion } from "@/lib/diagnostic/complete-diagnostic";
import { IntroScreens } from "./intro-screens";
import { DiagnosticRunner } from "./diagnostic-runner";
import { beginDiagnosticAction } from "./actions";

// PRD-012 §5/§27 — routes the student to the correct diagnostic state:
// Not Started (intro), In Progress (resume the runner), Completed (results).
export default async function DiagnosticPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");

  const diagnostic = await prisma.diagnosticSession.findUnique({
    where: { studentId: session.user.id },
    include: { attempts: { orderBy: { position: "asc" } } },
  });

  if (!diagnostic) {
    return <IntroScreens onBegin={beginDiagnosticAction} />;
  }

  if (diagnostic.status === "COMPLETED") {
    redirect("/diagnostic/results");
  }

  // Content-coverage fallback (see start-diagnostic.ts): if literally nothing
  // was published anywhere, the session can exist with zero attempts. There's
  // nothing to run — complete it immediately (every category falls back to
  // its conservative "missing = incorrect" Ability Score) instead of the
  // runner crashing on an empty question list.
  if (diagnostic.attempts.length === 0) {
    await finalizeDiagnosticCompletion(session.user.id);
    redirect("/diagnostic/results");
  }

  const items = diagnostic.attempts.map((a) => ({
    id: a.id,
    position: a.position,
    submitted: a.submittedAt !== null,
    studentAnswer: a.answer,
    isCorrect: a.isCorrect,
    draftAnswer: a.draftAnswer,
    skipped: a.skipped,
  }));

  const currentPosition = Math.min(diagnostic.currentPosition, items.length - 1);
  const currentAttempt = diagnostic.attempts[currentPosition];
  const content = await getStudentQuestionContent(currentAttempt.questionRevisionId);
  const feedback = currentAttempt.submittedAt ? await getStudentQuestionFeedback(currentAttempt.questionRevisionId) : null;

  return (
    <DiagnosticRunner
      items={items}
      initialPosition={currentPosition}
      initialQuestion={{ content, feedback }}
    />
  );
}
