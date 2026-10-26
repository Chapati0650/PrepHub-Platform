import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getHomeworkForStudent, type HomeworkBlock } from "@/lib/teacher/homework";
import { formatGoalDate } from "@/lib/community/goal";
import { Button } from "@/components/ui/button";
import { startHomeworkAction } from "../actions";

const ERRORS: Record<string, string> = {
  ASSIGNMENT_CLOSED: "Your teacher has closed this homework.",
  NOT_IN_CLASS: "You're not in this class any more.",
  NOT_FOUND: "This homework isn't available.",
};

// Before starting, or coming back to unfinished work: why it can't go on.
const BLOCKED: Record<HomeworkBlock, string> = {
  NOT_IN_CLASS: "You're not in this class any more.",
  CLASS_CLOSED: "Your teacher has closed this class.",
  ASSIGNMENT_CLOSED: "Your teacher has closed this homework.",
};

// The page before question 1 — never the runner itself, so opening a link
// from the list doesn't start anything. Left-aligned on a tint, like every
// status screen (CLAUDE.md).
export default async function HomeworkStartPage({
  params,
  searchParams,
}: {
  params: Promise<{ assignmentId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "STUDENT") redirect("/home");

  const [{ assignmentId }, { error }] = await Promise.all([params, searchParams]);
  const homework = await getHomeworkForStudent(session.user.id, assignmentId);
  if (!homework) redirect("/homework");
  if (homework.session?.status === "COMPLETED") redirect(`/homework/results/${homework.session.id}`);

  const inProgress = homework.session?.status === "ACTIVE";
  // Already due when this student joined: theirs to do, never "was due" in red.
  const overdue = homework.dueAt && homework.dueAt < new Date() && !homework.setBeforeJoining;
  const { blocked } = homework;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-4 pb-16 sm:p-8">
      <Link href="/homework" className="text-sm text-muted-foreground hover:text-foreground">
        ← Homework
      </Link>
      <section className="rounded-3xl bg-surface-tint p-6 sm:p-10">
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          {homework.className} · {homework.teacherFirstName}
        </p>
        <h1 className="mt-3 text-page-title sm:text-page-title-lg">{homework.title}</h1>
        <p className="mt-3 text-muted-foreground">
          {homework.questionCount} question{homework.questionCount === 1 ? "" : "s"}
          {homework.dueAt && (
            <>
              {" · "}
              <span className={overdue ? "font-medium text-destructive" : undefined}>
                {overdue ? "was due" : "due"} {formatGoalDate(homework.dueAt)}
              </span>
            </>
          )}
        </p>
        {homework.instructions && (
          <div className="mt-5 border-l-2 border-marker pl-3">
            <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              From {homework.teacherFirstName}
            </p>
            <p className="mt-1 whitespace-pre-line">{homework.instructions}</p>
          </div>
        )}

        {error && ERRORS[error] && !blocked && <p className="mt-5 text-sm text-destructive">{ERRORS[error]}</p>}

        {blocked ? (
          <p className="mt-8 font-medium">{BLOCKED[blocked]}</p>
        ) : (
          <form action={startHomeworkAction} className="mt-8">
            <input type="hidden" name="assignmentId" value={homework.id} />
            <Button type="submit" size="cta">
              {inProgress ? "Continue" : "Start"}
            </Button>
          </form>
        )}
        {!blocked && (
          <p className="mt-4 text-sm text-muted-foreground">
            Every question shows its explanation after you answer. Your teacher sees each answer as you give it, and
            it&apos;s turned in when you&apos;ve answered them all.
            {overdue && " It's past due, but your teacher still accepts it — it's just marked late."}
            {homework.setBeforeJoining &&
              " It was set before you joined the class, so it's up to you — it won't count as missing."}
          </p>
        )}
      </section>
    </div>
  );
}
