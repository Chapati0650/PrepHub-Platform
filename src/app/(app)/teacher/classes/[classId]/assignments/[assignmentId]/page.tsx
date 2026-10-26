import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/teacher/access";
import { getAssignmentResults } from "@/lib/teacher/assignments";
import { TeacherError } from "@/lib/teacher/errors";
import { formatGoalDate, localDateInputValue } from "@/lib/community/goal";
import { StaffHeader, StaffPage, StaffSection, StatStrip, StatusChip } from "@/components/staff/staff-ui";
import { AssignmentControls, QuestionBreakdown } from "./results-controls";

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
  const pastDue = results.closed || (results.dueAt !== null && results.dueAt < new Date());
  const { summary } = results;
  const notStartedHint = [
    results.closed ? "closed before they started" : pastDue ? "the due date has passed" : "still time to start",
    summary.joinedLater > 0 && `not counting ${summary.joinedLater} who joined later`,
  ]
    .filter(Boolean)
    .join("; ");

  return (
    <StaffPage>
      <StaffHeader
        back={{ href: `/teacher/classes/${classId}`, label: results.classroom.name }}
        eyebrow={`Homework · ${total} question${total === 1 ? "" : "s"}`}
        title={results.title}
        description={
          <>
            <span className="flex flex-wrap items-center gap-2">
              <StatusChip tone={pastDue ? "muted" : "good"}>
                {results.closed
                  ? "Closed"
                  : results.dueAt
                    ? `${pastDue ? "Was due" : "Due"} ${formatGoalDate(results.dueAt)}`
                    : "No due date"}
              </StatusChip>
            </span>
            {results.instructions && (
              <span className="mt-3 block whitespace-pre-line">
                <span className="font-medium text-foreground">Your instructions: </span>
                {results.instructions}
              </span>
            )}
          </>
        }
      />

      <StatStrip
        stats={[
          {
            label: "Finished",
            value: `${summary.completed} of ${summary.roster}`,
            hint:
              summary.leftCompleted > 0
                ? `students who turned it in; ${summary.leftCompleted} more who have since left`
                : "students who turned it in",
          },
          { label: "Started", value: String(summary.inProgress), hint: "partway through" },
          { label: "Not started", value: String(summary.notStarted), hint: notStartedHint },
          {
            label: "Class average",
            value: summary.averagePercent === null ? "—" : `${summary.averagePercent}%`,
            hint: "correct, among finished work",
          },
        ]}
      />

      <StaffSection
        title="Students"
        description={total > 0 ? "Missed questions are numbered in the order you assigned them." : undefined}
      >
        {results.students.length === 0 ? (
          <p className="rounded-2xl bg-surface-tint p-6 text-base text-muted-foreground">
            No students in this class yet. Share the class code and they&apos;ll see this homework when they join.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-base">
              <thead className="bg-muted/50 text-left text-sm">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Student
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Score
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Missed
                  </th>
                  <th scope="col" className="hidden px-4 py-3 text-right font-medium sm:table-cell">
                    Finished
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {results.students.map((s) => (
                  <tr key={s.studentId}>
                    <td className="px-4 py-3">
                      <span className="block font-medium">
                        {s.firstName}
                        {!s.enrolled && <span className="font-normal text-muted-foreground"> · left the class</span>}
                      </span>
                      <span className="block max-w-[10rem] truncate text-sm text-muted-foreground sm:max-w-[16rem]">
                        {s.email}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap gap-1.5">
                        {s.status === "COMPLETED" ? (
                          <StatusChip tone="good">Finished</StatusChip>
                        ) : s.status === "IN_PROGRESS" ? (
                          <StatusChip tone="warn">Started</StatusChip>
                        ) : s.joinedLater ? (
                          <StatusChip tone="muted">Joined later</StatusChip>
                        ) : pastDue ? (
                          <StatusChip tone="bad">Missing</StatusChip>
                        ) : (
                          <StatusChip tone="muted">Not started</StatusChip>
                        )}
                        {s.late && <StatusChip tone="warn">Late</StatusChip>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
                      {s.status === "NOT_STARTED" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          <span className="font-semibold">{s.correct}</span>
                          <span className="text-muted-foreground">
                            /{s.status === "COMPLETED" ? total : `${s.answered} so far`}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {s.missed.length === 0 ? (
                        <span className="text-muted-foreground">{s.status === "NOT_STARTED" ? "" : "None"}</span>
                      ) : (
                        s.missed.map((p) => `Q${p + 1}`).join(", ")
                      )}
                    </td>
                    <td className="hidden px-4 py-3 text-right text-muted-foreground sm:table-cell">
                      {s.completedAt ? formatGoalDate(s.completedAt) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </StaffSection>

      <QuestionBreakdown assignmentId={results.id} questions={results.questions} />

      <AssignmentControls
        assignmentId={results.id}
        classroomId={classId}
        closed={results.closed}
        canDelete={!startedAny}
        initial={{ title: results.title, instructions: results.instructions ?? "", dueOn: localDateInputValue(results.dueAt) }}
      />
    </StaffPage>
  );
}
