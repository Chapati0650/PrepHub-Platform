import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/teacher/access";
import { getClassroomDetail, type ClassroomDetail } from "@/lib/teacher/classrooms";
import { TeacherError } from "@/lib/teacher/errors";
import { formatJoinCode } from "@/lib/teacher/join-code";
import { joinedAfterDeadline } from "@/lib/teacher/deadline";
import { formatGoalDate } from "@/lib/community/goal";
import { LinkButton } from "@/components/ui/link-button";
import { StaffHeader, StaffPage, StaffSection, StatusChip } from "@/components/staff/staff-ui";
import { ClassCodePanel, ClassSettings, RemoveStudentButton } from "./class-controls";

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
  const studentCount = detail.students.length;

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
            <LinkButton href={`/teacher/classes/${detail.id}/assignments/new`} size="cta">
              Assign homework
            </LinkButton>
          )
        }
      />

      {!detail.archived && (
        <ClassCodePanel classroomId={detail.id} code={formatJoinCode(detail.joinCode)} joinUrl={joinUrl} />
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
              const share = studentCount > 0 ? Math.round((a.completed / studentCount) * 100) : 0;
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
                        <span>
                          {a.questionCount} question{a.questionCount === 1 ? "" : "s"}
                        </span>
                      </span>
                    </span>
                    <span className="flex w-full flex-col gap-1.5 md:w-56">
                      <span className="flex justify-between text-base tabular-nums">
                        <span>
                          <span className="font-semibold">{a.completed}</span> of {studentCount} done
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
            ? "Each student's score on each homework. “Missing” means the due date passed before they started; “Joined later” means it was already due when they joined, so it isn't held against them."
            : undefined
        }
      >
        {studentCount === 0 ? (
          <p className="rounded-2xl bg-surface-tint p-6 text-base text-muted-foreground">
            No one has joined yet. Share the code above: students join from their own PrepHub account, and they appear
            here the moment they do.
          </p>
        ) : (
          <Gradebook detail={detail} now={now} />
        )}
      </StaffSection>

      <ClassSettings classroomId={detail.id} name={detail.name} archived={detail.archived} />
    </StaffPage>
  );
}

/**
 * Students down the side, homework across the top, the score where they
 * meet. The view a teacher already knows from a paper gradebook or Google
 * Classroom, so it needs no explaining. Scrolls sideways once there's more
 * homework than fits, with the names pinned so a row never loses its student.
 */
function Gradebook({ detail, now }: { detail: ClassroomDetail; now: Date }) {
  const results = new Map(detail.submissions.map((s) => [`${s.studentId}:${s.assignmentId}`, s]));
  const assignments = detail.assignments;
  // The homework a student was in the class for, plus any from before they
  // joined that they did anyway, so a late joiner isn't "0 of 5" for work set
  // before they arrived, and "done" can never exceed "of".
  const owedBy = (s: ClassroomDetail["students"][number]) =>
    assignments.filter(
      (a) =>
        !joinedAfterDeadline(s.joinedAt, a) || results.get(`${s.studentId}:${a.id}`)?.status === "COMPLETED",
    ).length;

  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
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
            {!detail.archived && (
              <th scope="col" className="bg-muted/60 px-3 py-3">
                <span className="sr-only">Remove from class</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {detail.students.map((s) => (
            <tr key={s.studentId} className="group">
              <th scope="row" className="sticky left-0 z-10 bg-background px-4 py-3 text-left font-normal group-hover:bg-muted">
                <span className="block font-medium">{s.firstName}</span>
                <span className="block max-w-56 truncate text-sm text-muted-foreground">{s.email}</span>
              </th>
              {assignments.map((a) => {
                const r = results.get(`${s.studentId}:${a.id}`);
                // Already due (or closed) when they joined: never "Missing".
                const joinedLater = !r && joinedAfterDeadline(s.joinedAt, a);
                const missed = !r && !joinedLater && (a.closed || (a.dueAt !== null && a.dueAt < now));
                return (
                  <td key={a.id} className="px-3 py-3 tabular-nums group-hover:bg-muted/40">
                    {r?.status === "COMPLETED" ? (
                      <span title={a.questionCount > 0 ? `${Math.round((r.correct / a.questionCount) * 100)}% correct` : undefined}>
                        <span className="font-semibold">{r.correct}</span>
                        <span className="text-muted-foreground">/{a.questionCount}</span>
                      </span>
                    ) : r ? (
                      <StatusChip tone="warn">Started</StatusChip>
                    ) : missed ? (
                      <StatusChip tone="bad">Missing</StatusChip>
                    ) : joinedLater ? (
                      <StatusChip tone="muted">Joined later</StatusChip>
                    ) : (
                      <span className="text-muted-foreground">
                        <span aria-hidden>—</span>
                        <span className="sr-only">Not started</span>
                      </span>
                    )}
                  </td>
                );
              })}
              <td className="px-3 py-3 tabular-nums group-hover:bg-muted/40">
                {s.completedAssignments} of {owedBy(s)}
              </td>
              {!detail.archived && (
                <td className="px-3 py-3 text-right group-hover:bg-muted/40">
                  <RemoveStudentButton classroomId={detail.id} studentId={s.studentId} firstName={s.firstName} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
