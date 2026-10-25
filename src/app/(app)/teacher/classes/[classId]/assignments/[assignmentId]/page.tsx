import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/teacher/access";
import { getAssignmentResults } from "@/lib/teacher/assignments";
import { TeacherError } from "@/lib/teacher/errors";
import { formatGoalDate, localDateInputValue } from "@/lib/community/goal";
import { AssignmentControls, QuestionBreakdown } from "./results-controls";

const STATUS_LABEL = { COMPLETED: "Done", IN_PROGRESS: "In progress", NOT_STARTED: "Not started" } as const;

export default async function AssignmentResultsPage({
  params,
}: {
  params: Promise<{ classId: string; assignmentId: string }>;
}) {
  const context = await requireTeacher();
  const { classId, assignmentId } = await params;

  let results;
  try {
    results = await getAssignmentResults(context, assignmentId);
  } catch (err) {
    if (err instanceof TeacherError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  if (results.classroom.id !== classId) notFound();

  const total = results.questions.length;
  const startedAny = results.students.some((s) => s.status !== "NOT_STARTED");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 p-4 pb-16 sm:p-8">
      <div className="flex flex-col gap-2">
        <Link href={`/teacher/classes/${classId}`} className="text-sm text-muted-foreground hover:text-foreground">
          ← {results.classroom.name}
        </Link>
        <div className="border-b border-border pb-6">
          <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Homework · {total} question{total === 1 ? "" : "s"}
            {results.dueAt && ` · due ${formatGoalDate(results.dueAt)}`}
            {results.closed && " · closed"}
          </p>
          <h1 className="mt-1.5 text-page-title sm:text-page-title-lg">{results.title}</h1>
          {results.instructions && <p className="mt-2 max-w-2xl whitespace-pre-line text-muted-foreground">{results.instructions}</p>}
        </div>
      </div>

      {/* One row of four, rules not boxes (CLAUDE.md). */}
      <section aria-label="Summary" className="grid grid-cols-2 divide-border rounded-2xl border border-border sm:grid-cols-4 sm:divide-x">
        <SummaryStat label="Done" value={`${results.summary.completed}/${results.summary.roster}`} />
        <SummaryStat label="In progress" value={String(results.summary.inProgress)} />
        <SummaryStat label="Not started" value={String(results.summary.notStarted)} />
        <SummaryStat
          label="Class average"
          value={results.summary.averagePercent === null ? "—" : `${results.summary.averagePercent}%`}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Students</h2>
        {results.students.length === 0 ? (
          <p className="rounded-2xl bg-surface-tint p-5 text-sm text-muted-foreground">
            No students in this class yet. Share the class code and they&apos;ll see this homework when they join.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-y border-border text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">Student</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Score</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Missed</th>
                  <th scope="col" className="py-2 text-right font-medium">Finished</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {results.students.map((s) => (
                  <tr key={s.studentId}>
                    <td className="py-3 pr-4">
                      <span className="block font-medium">
                        {s.firstName}
                        {!s.enrolled && <span className="font-normal text-muted-foreground"> · left the class</span>}
                      </span>
                      <span className="block max-w-[14rem] truncate text-xs text-muted-foreground">{s.email}</span>
                    </td>
                    <td className="py-3 pr-4">
                      {STATUS_LABEL[s.status]}
                      {s.late && <span className="ml-1.5 rounded-md bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Late</span>}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums">
                      {s.status === "NOT_STARTED" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          <span className="font-semibold">{s.correct}</span>
                          <span className="text-muted-foreground">/{s.status === "COMPLETED" ? total : `${s.answered} so far`}</span>
                        </>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-xs text-muted-foreground tabular-nums">
                      {s.missed.length === 0 ? (s.status === "NOT_STARTED" ? "" : "none") : s.missed.map((p) => `Q${p + 1}`).join(", ")}
                    </td>
                    <td className="py-3 text-right text-xs text-muted-foreground">
                      {s.completedAt ? formatGoalDate(s.completedAt) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <QuestionBreakdown assignmentId={results.id} questions={results.questions} />

      <AssignmentControls
        assignmentId={results.id}
        classroomId={classId}
        closed={results.closed}
        canDelete={!startedAny}
        initial={{ title: results.title, instructions: results.instructions ?? "", dueOn: localDateInputValue(results.dueAt) }}
      />
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 sm:p-5">
      <p className="font-heading text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
