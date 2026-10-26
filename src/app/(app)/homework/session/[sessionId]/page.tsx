import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getStudentQuestionContent, getStudentQuestionFeedback } from "@/lib/session/question-content";
import {
  completeHomeworkSession,
  getHomeworkSessionForRunner,
  HOMEWORK_BLOCKED_MESSAGES,
  type HomeworkBlock,
} from "@/lib/teacher/homework";
import { LinkButton } from "@/components/ui/link-button";
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

  // Every question answered but never turned in: answered before the last
  // answer turned homework in by itself, or two last answers that raced.
  // Turning it in is the one thing left to do, and it's dated by the last
  // answer, so it's done here rather than leaving a finished runner open.
  const answered = homework.slots.filter((s) => s.finalizedAt !== null).length;
  if (answered === homework.slots.length) {
    await completeHomeworkSession(session.user.id, homework.id);
    redirect(`/homework/results/${homework.id}`);
  }

  if (homework.blocked) {
    return (
      <HomeworkClosed
        blocked={homework.blocked}
        title={homework.assignment.title}
        classroomName={homework.assignment.classroom.name}
        answered={answered}
        total={homework.slots.length}
      />
    );
  }

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

/**
 * The teacher closed the homework or the class, or took the student off the
 * roster, before they finished. Said plainly in place of a runner that would
 * refuse every answer. Left-aligned on a tint, like every status screen.
 */
function HomeworkClosed({
  blocked,
  title,
  classroomName,
  answered,
  total,
}: {
  blocked: HomeworkBlock;
  title: string;
  classroomName: string;
  answered: number;
  total: number;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col p-4 pb-16 sm:p-8">
      <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Homework · {classroomName}
        </p>
        <h1 className="mt-3 text-page-title sm:text-page-title-lg">{title}</h1>
        <p className="mt-4 text-lg">{HOMEWORK_BLOCKED_MESSAGES[blocked]}</p>
        {answered > 0 && (
          <p className="mt-2 text-muted-foreground tabular-nums">
            You answered {answered} of {total} question{total === 1 ? "" : "s"}.
          </p>
        )}
        <LinkButton size="cta" href="/homework" className="mt-8">
          Back to Homework
        </LinkButton>
      </section>
    </div>
  );
}
