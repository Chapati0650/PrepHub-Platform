import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listHomework, listStudentClasses, type HomeworkItem } from "@/lib/teacher/homework";
import { formatGoalDate } from "@/lib/community/goal";
import { PageHeader } from "@/components/page-header";
import { ClassLastNameForm, JoinClassForm, LeaveClassButton } from "./join-class-form";

export const metadata = { title: "Homework" };

// Exactly what a teacher's pages show about a student, so the sentence is
// true: their roster and gradebook carry the email, not only the results.
const TEACHER_SEES =
  "Your teacher sees your first name, the last name you give their class, your email address, and your results on the homework they assign — nothing else from your PrepHub account.";

// Homework from every class the student is in. Reached from the nav (shown
// once they're in a class), from a teacher's join link, or by typing a code
// here — which is also where a student with no class yet ends up.
export default async function HomeworkPage({ searchParams }: { searchParams: Promise<{ joined?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "STUDENT") redirect("/home");

  const { joined } = await searchParams;
  const [classes, homework] = await Promise.all([listStudentClasses(session.user.id), listHomework(session.user.id)]);
  const now = new Date();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 p-4 pb-16 sm:p-8">
      <PageHeader
        eyebrow={homework.todo.length > 0 ? "Homework" : undefined}
        title={homework.todo.length > 0 ? `${homework.todo.length} to do` : "Homework"}
      />

      {joined && classes.length > 0 && (
        <p role="status" className="border-l-2 border-marker pl-3 text-sm">
          You&apos;re in. Anything your teacher assigns shows up here.
        </p>
      )}

      {classes.length === 0 ? (
        <section className="rounded-3xl bg-surface-tint p-6 sm:p-8">
          <h2 className="text-xl font-semibold">Join your class</h2>
          <p className="mt-2 max-w-prose text-muted-foreground">
            If your teacher assigns PrepHub homework, they&apos;ll give you a six-character class code. Enter it here.
          </p>
          <div className="mt-5 max-w-sm">
            <JoinClassForm />
          </div>
          <p className="mt-5 text-xs text-muted-foreground">{TEACHER_SEES}</p>
        </section>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">To do</h2>
            {homework.todo.length === 0 ? (
              <p className="rounded-2xl bg-surface-tint p-5 text-sm text-muted-foreground">
                All caught up. New homework from your teacher appears here.
              </p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {homework.todo.map((item) => (
                  <HomeworkRow key={item.assignmentId} item={item} now={now} />
                ))}
              </ul>
            )}
          </section>

          {homework.earlier.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                From before you joined
              </h2>
              <p className="text-sm text-muted-foreground">
                Your class had these before you joined. They&apos;re here if you want the practice, and they won&apos;t
                count as missing.
              </p>
              <ul className="divide-y divide-border border-y border-border">
                {homework.earlier.map((item) => (
                  <HomeworkRow key={item.assignmentId} item={item} now={now} />
                ))}
              </ul>
            </section>
          )}

          {homework.closed.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Closed before you finished
              </h2>
              <p className="text-sm text-muted-foreground">
                Your teacher closed these while you were partway through. They can&apos;t take new answers, and your
                teacher sees the ones you gave.
              </p>
              <ul className="divide-y divide-border border-y border-border">
                {homework.closed.map((item) => (
                  <HomeworkRow key={item.assignmentId} item={item} now={now} />
                ))}
              </ul>
            </section>
          )}

          {homework.done.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Done</h2>
              <ul className="divide-y divide-border border-y border-border">
                {homework.done.map((item) => (
                  <HomeworkRow key={item.assignmentId} item={item} now={now} />
                ))}
              </ul>
            </section>
          )}

          {/* Spacing, not a rule: the list above already ends on one, and two
              rules with a gap between read as an empty row. */}
          <section className="flex flex-col gap-4 pt-6">
            <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Your classes</h2>
            <ul className="divide-y divide-border border-y border-border">
              {classes.map((c) => (
                <li key={c.classroomId} className="py-3 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <span>
                      <span className="block font-medium">{c.name}</span>
                      <span className="text-muted-foreground">
                        {c.teacherName} · {c.schoolName}
                      </span>
                    </span>
                    <LeaveClassButton classroomId={c.classroomId} className={c.name} />
                  </div>
                  {/* Joined before classes asked for a last name. */}
                  {!c.lastName && <ClassLastNameForm classroomId={c.classroomId} className={c.name} />}
                </li>
              ))}
            </ul>
            <div className="max-w-sm">
              <p className="mb-2 text-sm font-medium">Join another class</p>
              <JoinClassForm />
            </div>
            <p className="text-xs text-muted-foreground">{TEACHER_SEES}</p>
          </section>
        </>
      )}
    </div>
  );
}

function HomeworkRow({ item, now }: { item: HomeworkItem; now: Date }) {
  // Closed partway through: nothing left to do, so neither red nor "Start".
  const closedEarly = item.closed && item.status === "IN_PROGRESS" && !item.readyToTurnIn;
  // Never red for homework that was already due when the student joined.
  const overdue =
    item.status !== "COMPLETED" && !closedEarly && item.dueAt && item.dueAt < now && !item.setBeforeJoining;
  // Every question answered but not yet turned in: the session page turns it
  // in and shows the results, even if the teacher has since closed it.
  // Closed partway through goes to the homework's own page, which says so.
  const href =
    item.status === "COMPLETED" && item.sessionId
      ? `/homework/results/${item.sessionId}`
      : item.readyToTurnIn && item.sessionId
        ? `/homework/session/${item.sessionId}`
        : `/homework/${item.assignmentId}`;
  return (
    <li>
      <Link href={href} className="flex items-center justify-between gap-4 py-4">
        <span className="min-w-0">
          <span className="block font-medium">{item.title}</span>
          <span className="text-sm text-muted-foreground">
            {item.className} · {item.mode === "QUIZ" ? "Quiz · " : ""}
            {item.questionCount} question{item.questionCount === 1 ? "" : "s"}
            {item.dueAt && (
              <>
                {" · "}
                <span className={overdue ? "font-medium text-destructive" : undefined}>
                  {overdue ? "was due" : "due"} {formatGoalDate(item.dueAt)}
                </span>
              </>
            )}
          </span>
        </span>
        <span className="shrink-0 text-right text-sm tabular-nums">
          {item.status === "COMPLETED" ? (
            <>
              <span className="font-semibold">{item.correct}</span>
              <span className="text-muted-foreground">/{item.questionCount}</span>
            </>
          ) : closedEarly ? (
            <span className="text-muted-foreground">
              Closed · {item.answered} of {item.questionCount} answered
            </span>
          ) : item.status === "IN_PROGRESS" ? (
            <span className="text-muted-foreground">
              {item.answered}/{item.questionCount} answered
            </span>
          ) : (
            <span className="font-medium text-primary">Start</span>
          )}
        </span>
      </Link>
    </li>
  );
}
