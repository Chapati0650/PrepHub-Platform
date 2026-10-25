import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/teacher/access";
import { getClassroomDetail } from "@/lib/teacher/classrooms";
import { TeacherError } from "@/lib/teacher/errors";
import { formatJoinCode } from "@/lib/teacher/join-code";
import { formatGoalDate } from "@/lib/community/goal";
import { LinkButton } from "@/components/ui/link-button";
import { ClassCodePanel, ClassSettings, RemoveStudentButton } from "./class-controls";

export default async function ClassroomPage({ params }: { params: Promise<{ classId: string }> }) {
  const context = await requireTeacher();
  const { classId } = await params;

  let detail;
  try {
    detail = await getClassroomDetail(context, classId);
  } catch (err) {
    if (err instanceof TeacherError && err.code === "NOT_FOUND") notFound();
    throw err;
  }

  const joinUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/join/${detail.joinCode}`;
  const now = new Date();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 p-4 pb-16 sm:p-8">
      <div className="flex flex-col gap-2">
        <Link href="/teacher" className="text-sm text-muted-foreground hover:text-foreground">
          ← Your classes
        </Link>
        <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              {context.schoolName}
              {detail.archived && " · Archived"}
            </p>
            <h1 className="mt-1.5 text-page-title sm:text-page-title-lg">{detail.name}</h1>
          </div>
          {!detail.archived && (
            <LinkButton href={`/teacher/classes/${detail.id}/assignments/new`} size="cta">
              Assign homework
            </LinkButton>
          )}
        </div>
      </div>

      {!detail.archived && (
        <ClassCodePanel classroomId={detail.id} code={formatJoinCode(detail.joinCode)} joinUrl={joinUrl} />
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Homework</h2>
        {detail.assignments.length === 0 ? (
          <p className="rounded-2xl bg-surface-tint p-5 text-sm text-muted-foreground">
            Nothing assigned yet. Pick questions from the bank — by category and difficulty, or one by one — and the
            class sees them on their Homework page.
          </p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {detail.assignments.map((a) => {
              const overdue = a.dueAt && a.dueAt < now && !a.closed;
              return (
                <li key={a.id}>
                  <Link
                    href={`/teacher/classes/${detail.id}/assignments/${a.id}`}
                    className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">{a.title}</span>
                      <span className="text-sm text-muted-foreground">
                        {a.questionCount} question{a.questionCount === 1 ? "" : "s"}
                        {a.dueAt && ` · due ${formatGoalDate(a.dueAt)}`}
                        {a.closed && " · closed"}
                        {overdue && " · past due"}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-6 text-sm tabular-nums">
                      <span>
                        <span className="font-semibold">{a.completed}</span>
                        <span className="text-muted-foreground">/{detail.students.length} done</span>
                      </span>
                      <span className="w-20 text-right">
                        {a.averagePercent === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            <span className="font-semibold">{a.averagePercent}%</span>
                            <span className="text-muted-foreground"> avg</span>
                          </>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Students · {detail.students.length}
        </h2>
        {detail.students.length === 0 ? (
          <p className="rounded-2xl bg-surface-tint p-5 text-sm text-muted-foreground">
            No one has joined yet. Share the code above — students join from their own PrepHub account, and they
            appear here the moment they do.
          </p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {detail.students.map((s) => (
              <li key={s.studentId} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block font-medium">{s.firstName}</span>
                  <span className="block truncate text-muted-foreground">{s.email}</span>
                </span>
                <span className="flex shrink-0 items-center gap-4">
                  <span className="text-muted-foreground tabular-nums">
                    {s.completedAssignments}/{detail.assignments.length} done
                  </span>
                  {!detail.archived && (
                    <RemoveStudentButton classroomId={detail.id} studentId={s.studentId} firstName={s.firstName} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ClassSettings classroomId={detail.id} name={detail.name} archived={detail.archived} />
    </div>
  );
}
