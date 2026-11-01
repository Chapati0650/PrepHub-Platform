import Link from "next/link";
import { getTeacherContext, requireTeacherSession } from "@/lib/teacher/access";
import { listClassrooms, type ClassroomSummary } from "@/lib/teacher/classrooms";
import { formatJoinCode } from "@/lib/teacher/join-code";
import { formatGoalDate } from "@/lib/community/goal";
import { StaffHeader, StaffPage, StaffSection, StaffSteps, StatusChip } from "@/components/staff/staff-ui";
import { NewClassForm } from "./new-class-form";
import { DisplayNameForm } from "./display-name-form";

export const metadata = { title: "Your classes" };

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

// A teacher's home: their classes, and making a new one. Teachers land here
// from /home (they have no student dashboard of their own). Laid out on the
// staff pages' terms (2026-10-25): each class card says what's due next and
// how far the class has got, so the page answers "what needs my attention?"
// without opening anything.
export default async function TeacherHomePage() {
  const userId = await requireTeacherSession();
  const context = await getTeacherContext(userId);

  // Removed by their school: the classes still exist, but this account can't
  // open them. Said plainly rather than shown as an empty list, which would
  // read as "your classes are gone".
  if (!context) {
    return (
      <StaffPage className="max-w-2xl">
        <div className="rounded-3xl bg-surface-tint p-6 sm:p-8">
          <h1 className="text-page-title">Your teaching access has ended.</h1>
          <p className="mt-3 text-lg text-foreground/75">
            Your school has removed this account&apos;s teacher access. Your classes and your students&apos; work are
            kept. If this is a mistake, ask your school&apos;s PrepHub administrator to add you back.
          </p>
        </div>
      </StaffPage>
    );
  }

  const classes = await listClassrooms(context);
  const open = classes.filter((c) => !c.archived);
  const archived = classes.filter((c) => c.archived);

  return (
    <StaffPage>
      <StaffHeader
        eyebrow={context.schoolName}
        title={`Your classes, ${context.firstName}`}
        description="Make a class, give your students its code, then assign PrepHub questions as homework and see how each student did."
      />

      {/* The name on every homework and email students get, so it's up
          front. One block in one place whether or not it's set yet: saving
          re-renders the page, and a form that moved elsewhere would lose its
          "Saved." the moment it appeared. */}
      <div className="max-w-xl rounded-2xl border border-border p-5 sm:p-6">
        <p className="mb-3 text-base">
          Students see you as{" "}
          <span className="font-medium">{context.teacherDisplayName ?? context.firstName}</span>.
          {!context.teacherDisplayName && " Most teachers use the name their class calls them."}
        </p>
        <DisplayNameForm current={context.teacherDisplayName} firstName={context.firstName} />
      </div>

      {open.length === 0 ? (
        <StaffSection title="Getting started">
          <StaffSteps
            steps={[
              { title: "Make a class", body: "Name it the way your students know it, like “3rd period SAT Prep”." },
              {
                title: "Give your students its code",
                body: "They type the six-character code into PrepHub, or open the link you share. They join from their own account.",
              },
              {
                title: "Assign homework",
                body: "Pick questions from PrepHub's bank, set a due date, and see who finished and which questions they missed.",
              },
            ]}
          />
        </StaffSection>
      ) : (
        <StaffSection title={open.length === 1 ? "Your class" : `Your classes (${open.length})`}>
          <ul className="grid gap-5 md:grid-cols-2">
            {open.map((c) => (
              <ClassCard key={c.id} classroom={c} />
            ))}
          </ul>
        </StaffSection>
      )}

      <StaffSection
        id="new-class"
        title={open.length === 0 ? "Make your first class" : "Make a new class"}
        description="Students see this name when they join."
      >
        <div className="max-w-xl rounded-2xl border border-border p-5 sm:p-6">
          <NewClassForm />
        </div>
      </StaffSection>

      {archived.length > 0 && (
        <StaffSection title="Archived classes" description="Closed to new students. Every result is kept, and you can restore a class from its page.">
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {archived.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/teacher/classes/${c.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 p-5 text-base hover:bg-muted/40"
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="text-muted-foreground">
                    {plural(c.studentCount, "student")} · {plural(c.assignmentCount, "assignment")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </StaffSection>
      )}
    </StaffPage>
  );
}

function ClassCard({ classroom: c }: { classroom: ClassroomSummary }) {
  return (
    <li>
      <Link
        href={`/teacher/classes/${c.id}`}
        className="flex h-full flex-col gap-5 rounded-2xl border border-border p-5 transition-colors hover:border-foreground/30 hover:bg-muted/20 sm:p-6"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="text-xl font-semibold">{c.name}</span>
          <span className="shrink-0 text-base font-medium text-primary">Open →</span>
        </span>

        <span className="grid grid-cols-3 divide-x divide-border text-base">
          <span className="pr-4">
            <span className="block font-heading text-3xl font-semibold tabular-nums">{c.studentCount}</span>
            <span className="text-muted-foreground">student{c.studentCount === 1 ? "" : "s"}</span>
          </span>
          <span className="px-4">
            <span className="block font-heading text-3xl font-semibold tabular-nums">{c.assignmentCount}</span>
            <span className="text-muted-foreground">homework</span>
          </span>
          <span className="pl-4">
            <span className="block font-mono text-xl font-semibold tracking-wider">{formatJoinCode(c.joinCode)}</span>
            <span className="text-muted-foreground">class code</span>
          </span>
        </span>

        <span className="mt-auto flex flex-col gap-4 border-t border-border pt-4 text-base">
          {/* Past due and still owed, above what's next: "Nothing due right
              now" used to be all a teacher saw while half the class hadn't
              turned in last week's. */}
          {c.overdue && (
            <span className="block">
              <span className="block text-sm font-medium text-muted-foreground">
                Was due · {formatGoalDate(c.overdue.dueAt)}
              </span>
              <span className="mt-0.5 block font-medium">{c.overdue.title}</span>
              <span className="mt-1 block">
                <StatusChip tone="bad">
                  {c.overdue.unfinished} {c.overdue.unfinished === 1 ? "hasn't" : "haven't"} finished
                </StatusChip>
              </span>
            </span>
          )}
          {c.nextDue ? (
            <span className="block">
              <span className="block text-sm font-medium text-muted-foreground">Next due · {formatGoalDate(c.nextDue.dueAt)}</span>
              <span className="mt-0.5 block font-medium">{c.nextDue.title}</span>
              <span className="mt-0.5 block text-muted-foreground tabular-nums">
                {c.nextDue.completed} of {c.studentCount} done
              </span>
            </span>
          ) : c.studentCount === 0 ? (
            <span className="text-muted-foreground">No students yet. Share the class code to get them in.</span>
          ) : (
            !c.overdue && <span className="text-muted-foreground">Nothing due right now.</span>
          )}
        </span>
      </Link>
    </li>
  );
}
