import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/teacher/access";
import { getClassroomDetail, type ClassroomDetail, type ClassroomStudent } from "@/lib/teacher/classrooms";
import { TeacherError } from "@/lib/teacher/errors";
import { formatJoinCode, joinShareText, joinSiteLabel } from "@/lib/teacher/join-code";
import {
  gradebookCell,
  homeworkOwed,
  submissionKey,
  submissionsByKey,
  type GradebookCell,
} from "@/lib/teacher/gradebook-export";
import { studentFullName, studentRosterName } from "@/lib/teacher/names";
import { formatGoalDate } from "@/lib/community/goal";
import { LinkButton } from "@/components/ui/link-button";
import { StaffHeader, StaffPage, StaffSection, StatusChip } from "@/components/staff/staff-ui";
import { ClassCodePanel, ClassSettings, RemoveStudentButton } from "./class-controls";
import { ExtraTimeSelect } from "./extra-time";
import { listClassSessions } from "@/lib/guided/console";
import { classExtraTime } from "@/lib/guided/queries";

export const metadata = { title: "Class" };

const DAY_MS = 24 * 60 * 60 * 1000;

type Assignment = ClassroomDetail["assignments"][number];

/** When a homework is due, in words, and whether it needs attention. */
function dueStatus(a: Assignment, now: Date): { text: string; tone: "good" | "warn" | "muted" } {
  if (a.closed) return { text: "Closed", tone: "muted" };
  if (!a.dueAt) return { text: "No due date", tone: "muted" };
  if (a.dueAt < now) return { text: `Was due ${formatGoalDate(a.dueAt)}`, tone: "muted" };
  const days = Math.floor((a.dueAt.getTime() - now.getTime()) / DAY_MS);
  if (days <= 0) return { text: "Due today", tone: "warn" };
  if (days === 1) return { text: "Due tomorrow", tone: "warn" };
  return { text: `Due ${formatGoalDate(a.dueAt)} · in ${days} days`, tone: "good" };
}

export default async function ClassroomPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const context = await requireTeacher();
  const { classId } = await params;
  const justCreated = (await searchParams).new === "1";

  let detail;
  try {
    detail = await getClassroomDetail(context, classId);
  } catch (err) {
    if (err instanceof TeacherError && err.code === "NOT_FOUND") notFound();
    throw err;
  }

  const [sessions, extraTime] = await Promise.all([listClassSessions(detail.id), classExtraTime(detail.id)]);
  const openSession = sessions.find((s) => s.status === "OPEN") ?? null;
  const origin = (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const joinUrl = `${origin}/join/${detail.joinCode}`;
  const now = new Date();
  const studentCount = detail.students.length;
  const formerCount = detail.formerStudents.length;
  const missingLastNames = detail.students.filter((s) => !s.lastName).length;

  return (
    <StaffPage>
      <StaffHeader
        back={{ href: "/teacher", label: "Your classes" }}
        eyebrow={`${context.schoolName}${detail.archived ? " · Archived" : ""}`}
        title={detail.name}
        description={
          detail.archived
            ? "This class is archived: nobody can join, and students no longer see its homework. Every result is still here."
            : "Share the code with your students, assign homework, and see who has done what."
        }
        actions={
          !detail.archived && (
            <>
              <LinkButton
                href={openSession ? `/teacher/live/${openSession.id}` : `/teacher/classes/${detail.id}/live/new`}
                size="xl"
                variant="outline"
              >
                {openSession ? "Back to the Guided Session" : "Start a Guided Session"}
              </LinkButton>
              <LinkButton href={`/teacher/classes/${detail.id}/assignments/new`} size="cta">
                Assign homework
              </LinkButton>
            </>
          )
        }
      />

      {!detail.archived && (
        <ClassCodePanel
          classroomId={detail.id}
          className={detail.name}
          code={formatJoinCode(detail.joinCode)}
          joinUrl={joinUrl}
          site={joinSiteLabel(origin)}
          shareText={joinShareText(detail.name, detail.joinCode, origin)}
          empty={studentCount === 0}
          justCreated={justCreated && studentCount === 0}
        />
      )}

      {sessions.length > 0 && (
        <StaffSection
          title="Guided Sessions"
          description="Sessions you ran in class, teacher-led or individual practice. Open one for how each student did and who to check in with."
        >
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {sessions.map((s) => (
              <li key={s.id}>
                <Link
                  href={s.status === "OPEN" ? `/teacher/live/${s.id}` : `/teacher/classes/${detail.id}/live/${s.id}`}
                  className="flex flex-wrap items-center gap-x-6 gap-y-1 p-5 transition-colors hover:bg-muted/30"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-lg font-medium">{s.categoryLabel}</span>
                    <span className="text-base text-muted-foreground">
                      {s.mode === "INDIVIDUAL" ? "Individual practice" : "Teacher-led"} · {formatGoalDate(s.createdAt)}
                    </span>
                  </span>
                  <span className="text-base tabular-nums">
                    {s.joined} of {s.rosterThen} took part
                  </span>
                  {s.status === "OPEN" ? <StatusChip tone="good">Running now</StatusChip> : <StatusChip tone="muted">Ended</StatusChip>}
                </Link>
              </li>
            ))}
          </ul>
        </StaffSection>
      )}

      <StaffSection
        title="Homework"
        description={detail.assignments.length > 0 ? "Newest first. Open one to see each student's answers." : undefined}
      >
        {detail.assignments.length === 0 ? (
          <p className="rounded-2xl bg-surface-tint p-6 text-base text-muted-foreground">
            Nothing assigned yet. Press &ldquo;Assign homework&rdquo; to pick questions from the bank, by category and
            difficulty or one by one. Your class sees them on their Homework page.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {detail.assignments.map((a) => {
              const due = dueStatus(a, now);
              const share = a.expected > 0 ? Math.round((a.completed / a.expected) * 100) : 0;
              return (
                <li key={a.id}>
                  <Link
                    href={`/teacher/classes/${detail.id}/assignments/${a.id}`}
                    className="flex flex-col gap-4 p-5 transition-colors hover:bg-muted/30 md:flex-row md:items-center md:gap-8"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-lg font-medium">{a.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-muted-foreground">
                        <StatusChip tone={due.tone}>{due.text}</StatusChip>
                        {a.mode === "QUIZ" && <StatusChip tone="muted">Quiz</StatusChip>}
                        <span>
                          {a.questionCount} question{a.questionCount === 1 ? "" : "s"}
                        </span>
                      </span>
                    </span>
                    <span className="flex w-full flex-col gap-1.5 md:w-56">
                      <span className="flex justify-between text-base tabular-nums">
                        <span>
                          <span className="font-semibold">{a.completed}</span> of {a.expected} done
                        </span>
                        {a.inProgress > 0 && <span className="text-muted-foreground">{a.inProgress} started</span>}
                      </span>
                      <span className="h-2 overflow-hidden rounded-full bg-foreground/10" aria-hidden>
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                      </span>
                    </span>
                    <span className="text-base tabular-nums md:w-28 md:text-right">
                      {a.averagePercent === null ? (
                        <span className="text-muted-foreground">No scores yet</span>
                      ) : (
                        <>
                          <span className="font-semibold">{a.averagePercent}%</span>{" "}
                          <span className="text-muted-foreground">average</span>
                        </>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </StaffSection>

      <StaffSection
        title={`Who's done what (${studentCount} student${studentCount === 1 ? "" : "s"})`}
        description={
          studentCount > 0 && detail.assignments.length > 0
            ? "Each student's score on each homework. “Missing” means the due date passed before they started; “Joined later” means it was already due when they joined, so it isn't held against them. “Finished” counts homework that's due or closed, plus anything turned in early."
            : undefined
        }
        action={
          studentCount + formerCount > 0 && detail.assignments.length > 0 ? (
            // A download, not a page: a plain link, so the browser saves the file.
            <a
              href={`/teacher/classes/${detail.id}/export`}
              className="inline-flex h-11 items-center rounded-md border border-border px-4 text-base font-medium hover:bg-muted"
            >
              Download gradebook (CSV)
            </a>
          ) : undefined
        }
      >
        {studentCount === 0 ? (
          <p className="rounded-2xl bg-surface-tint p-6 text-base text-muted-foreground">
            No one has joined yet. Give students the class code in &ldquo;Add your students&rdquo; above: they join from
            their own PrepHub account, and appear here the moment they do.
          </p>
        ) : (
          <>
            {missingLastNames > 0 && (
              <p className="text-base text-muted-foreground">
                {missingLastNames === 1 ? "One student" : `${missingLastNames} students`} joined before classes asked for
                a last name, so they&apos;re listed by first name at the bottom. PrepHub asks them for it on their
                Homework page.
              </p>
            )}
            <Gradebook detail={detail} students={detail.students} now={now} />
          </>
        )}
        {/* Collapsed: they're not the class any more, but their grades are
            still the teacher's to record, and the download includes them. */}
        {formerCount > 0 && (
          <details className="rounded-2xl border border-border">
            <summary className="cursor-pointer p-5 text-base font-medium">
              Left the class ({formerCount})
            </summary>
            <div className="flex flex-col gap-3 px-5 pb-5">
              <p className="text-base text-muted-foreground">
                Students who left or were removed after doing some of this class&apos;s homework. Their work is kept,
                and it&apos;s in the gradebook download, marked as having left. They aren&apos;t counted in any
                &ldquo;of&rdquo; above.
              </p>
              <Gradebook detail={detail} students={detail.formerStudents} now={now} former />
            </div>
          </details>
        )}
      </StaffSection>

      {studentCount > 0 && !detail.archived && (
        <details className="rounded-2xl border border-border">
          <summary className="cursor-pointer p-5 text-lg font-medium">
            Extra time (504 plans and IEPs)
            {extraTime.size > 0 && (
              <span className="ml-2 text-base font-normal text-muted-foreground">
                {extraTime.size} student{extraTime.size === 1 ? "" : "s"}
              </span>
            )}
          </summary>
          <div className="flex flex-col gap-4 px-5 pb-5">
            <p className="text-base text-muted-foreground">
              Set once, privately. In a Guided Session these students see no countdown during the class questions, and
              their own questions get the longer clock. Students never see who else has it.
            </p>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {detail.students.map((s) => (
                <li key={s.studentId} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <span className="text-base">{studentRosterName(s)}</span>
                  <ExtraTimeSelect
                    classroomId={detail.id}
                    studentId={s.studentId}
                    name={studentFullName(s)}
                    value={extraTime.get(s.studentId) ?? "NONE"}
                  />
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      <ClassSettings classroomId={detail.id} name={detail.name} archived={detail.archived} />
    </StaffPage>
  );
}

/**
 * Students down the side, homework across the top, the score where they
 * meet. The view a teacher already knows from a paper gradebook or Google
 * Classroom, so it needs no explaining. Scrolls sideways once there's more
 * homework than fits, with the names pinned so a row never loses its student.
 *
 * Each cell is gradebookCell's verdict, the same one the CSV download writes,
 * so the page and the spreadsheet never disagree. `former` draws the students
 * who have left: their work is listed, nothing is "Missing", and there's no
 * Remove button.
 */
function Gradebook({
  detail,
  students,
  now,
  former = false,
}: {
  detail: ClassroomDetail;
  students: (ClassroomStudent & { leftAt?: Date })[];
  now: Date;
  former?: boolean;
}) {
  const results = submissionsByKey(detail);
  const assignments = detail.assignments;
  const removable = !detail.archived && !former;

  return (
    // `relative`: the sr-only labels in its cells are absolutely positioned,
    // and without a positioned ancestor inside the scroller they escape it
    // and widen the whole page on a phone.
    <div className="relative overflow-x-auto rounded-2xl border border-border">
      <table className="w-full border-collapse text-base">
        <thead className="text-left text-sm">
          <tr className="border-b border-border">
            <th scope="col" className="sticky left-0 z-10 min-w-44 bg-muted px-4 py-3 font-medium">
              Student
            </th>
            {assignments.map((a) => (
              <th key={a.id} scope="col" className="min-w-36 bg-muted/60 px-3 py-3 align-bottom font-medium">
                <Link
                  href={`/teacher/classes/${detail.id}/assignments/${a.id}`}
                  className="line-clamp-2 underline-offset-2 hover:underline"
                >
                  {a.title}
                </Link>
                <span className="mt-0.5 block font-normal text-muted-foreground">
                  {a.dueAt ? `Due ${formatGoalDate(a.dueAt)}` : "No due date"}
                </span>
              </th>
            ))}
            <th scope="col" className="min-w-24 bg-muted/60 px-3 py-3 align-bottom font-medium">
              Finished
            </th>
            {removable && (
              <th scope="col" className="bg-muted/60 px-3 py-3">
                <span className="sr-only">Remove from class</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {students.map((s) => (
            <tr key={s.studentId} className="group">
              <th scope="row" className="sticky left-0 z-10 bg-background px-4 py-3 text-left font-normal group-hover:bg-muted">
                <span className="block font-medium">{studentRosterName(s)}</span>
                <span className="block max-w-56 truncate text-sm text-muted-foreground">{s.email}</span>
                {s.leftAt && <span className="block text-sm text-muted-foreground">Left {formatGoalDate(s.leftAt)}</span>}
              </th>
              {assignments.map((a) => (
                <td key={a.id} className="px-3 py-3 tabular-nums group-hover:bg-muted/40">
                  <GradebookCellView
                    cell={gradebookCell(s, a, results.get(submissionKey(s.studentId, a.id)), now, { left: former })}
                  />
                </td>
              ))}
              <td className="px-3 py-3 tabular-nums group-hover:bg-muted/40">
                {/* Someone who has left owes nothing more, so theirs is a plain count. */}
                {former
                  ? s.completedAssignments
                  : `${s.completedAssignments} of ${homeworkOwed(s, assignments, results, now)}`}
              </td>
              {removable && (
                <td className="px-3 py-3 text-right group-hover:bg-muted/40">
                  <RemoveStudentButton classroomId={detail.id} studentId={s.studentId} firstName={studentFullName(s)} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GradebookCellView({ cell }: { cell: GradebookCell }) {
  switch (cell.kind) {
    case "score":
      return (
        <span className="flex flex-col items-start gap-1">
          <span title={cell.percent !== null ? `${cell.percent}% correct` : undefined}>
            <span className="font-semibold">{cell.correct}</span>
            <span className="text-muted-foreground">/{cell.total}</span>
          </span>
          {/* The same "Late" as the homework's own results (turnedInLate). */}
          {cell.late && <StatusChip tone="warn">Late</StatusChip>}
        </span>
      );
    case "started":
      return <StatusChip tone="warn">Started</StatusChip>;
    case "missing":
      return <StatusChip tone="bad">Missing</StatusChip>;
    case "joinedLater":
      return <StatusChip tone="muted">Joined later</StatusChip>;
    case "notStarted":
      return (
        <span className="text-muted-foreground">
          <span aria-hidden>—</span>
          <span className="sr-only">Not started</span>
        </span>
      );
  }
}
