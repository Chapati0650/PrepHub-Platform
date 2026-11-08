import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { auth } from "@/auth";
import { listHomework, listStudentClasses, type HomeworkItem } from "@/lib/teacher/homework";
import { describeDue, type DueTone } from "@/lib/teacher/homework-due";
import { Marker } from "@/components/ui/marker";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { ClassLastNameForm, JoinClassForm, LeaveClassButton } from "./join-class-form";

export const metadata = { title: "Homework" };

// Exactly what a teacher's pages show about a student, so the sentence is
// true: their roster and gradebook carry the email, not only the results.
const TEACHER_SEES =
  "Your teacher sees your first name, the last name you give their class, your email address, and your results on the homework they assign — nothing else from your PrepHub account.";

const JOIN_STEPS = [
  ["01", "Get the code", "Your teacher shares it in class or with a join link."],
  ["02", "Enter it with your last name", "So your teacher can tell two students apart."],
  ["03", "Homework appears here", "With its due date and your progress."],
] as const;

// Homework from every class the student is in. Reached from the nav (shown
// once they're in a class), from a teacher's join link, or by typing a code
// here — which is also where a student with no class yet ends up.
//
// Hierarchy: the one thing due next (a tint block, due date in words and a
// single pill), then what's coming up, then finished work with scores, then
// the classes. A student with no class gets the join form instead.
export default async function HomeworkPage({ searchParams }: { searchParams: Promise<{ joined?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "STUDENT") redirect("/home");

  const { joined } = await searchParams;
  const [classes, homework] = await Promise.all([listStudentClasses(session.user.id), listHomework(session.user.id)]);
  const now = new Date();
  const [next, ...laterTodo] = homework.todo;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 p-4 pb-16 sm:p-8">
      <PageHeader
        eyebrow={homework.todo.length > 0 ? "Homework" : undefined}
        title={homework.todo.length > 0 ? `${homework.todo.length} to do` : "Homework"}
        description={classes.length > 0 && homework.todo.length > 0 ? "Soonest due comes first." : undefined}
      />

      {joined && classes.length > 0 && (
        <p role="status" className="border-l-2 border-marker pl-3 text-sm">
          You&apos;re in. Anything your teacher assigns shows up here.
        </p>
      )}

      {classes.length === 0 ? (
        <section className="grid gap-8 rounded-3xl bg-surface-tint p-6 sm:p-10 md:grid-cols-[1fr_minmax(0,20rem)]">
          <div>
            <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              Homework from your teacher
            </p>
            <h2 className="mt-3 text-page-title sm:text-page-title-lg">
              Join your <Marker>class</Marker>
            </h2>
            <p className="mt-3 max-w-prose text-muted-foreground">
              If your teacher assigns PrepHub homework, they&apos;ll give you a six-character class code. Enter it here.
            </p>
            <ol className="mt-6 divide-y divide-border border-y border-border text-sm">
              {JOIN_STEPS.map(([n, t, d]) => (
                <li key={n} className="flex items-baseline gap-4 py-3">
                  <span className="font-heading font-semibold text-muted-foreground tabular-nums">{n}</span>
                  <span>
                    <span className="block font-medium">{t}</span>
                    <span className="text-muted-foreground">{d}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="self-start rounded-2xl border border-border bg-background p-5">
            <JoinClassForm />
            <p className="mt-5 text-xs text-muted-foreground">{TEACHER_SEES}</p>
          </div>
        </section>
      ) : (
        <>
          {next ? (
            <NextUp item={next} now={now} />
          ) : (
            <section className="flex items-start gap-4 rounded-3xl bg-surface-tint p-6 sm:p-8">
              <Check className="mt-1 size-6 shrink-0 text-primary" aria-hidden />
              <div>
                <h2 className="font-heading text-xl font-semibold tracking-tight">All caught up.</h2>
                <p className="mt-1 text-muted-foreground">New homework from your teacher appears here.</p>
              </div>
            </section>
          )}

          {laterTodo.length > 0 && (
            <ListSection title="Coming up" count={laterTodo.length}>
              {laterTodo.map((item) => (
                <HomeworkRow key={item.assignmentId} item={item} now={now} />
              ))}
            </ListSection>
          )}

          {homework.earlier.length > 0 && (
            <ListSection
              title="From before you joined"
              note="Your class had these before you joined. They're here if you want the practice, and they won't count as missing."
            >
              {homework.earlier.map((item) => (
                <HomeworkRow key={item.assignmentId} item={item} now={now} />
              ))}
            </ListSection>
          )}

          {homework.closed.length > 0 && (
            <ListSection
              title="Closed before you finished"
              note="Your teacher closed these while you were partway through. They can't take new answers, and your teacher sees the ones you gave."
            >
              {homework.closed.map((item) => (
                <HomeworkRow key={item.assignmentId} item={item} now={now} />
              ))}
            </ListSection>
          )}

          {homework.done.length > 0 && (
            <ListSection title="Done" count={homework.done.length}>
              {homework.done.map((item) => (
                <HomeworkRow key={item.assignmentId} item={item} now={now} />
              ))}
            </ListSection>
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
            <div className="max-w-sm rounded-2xl bg-surface-tint p-5">
              <p className="mb-3 font-heading font-semibold">Join another class</p>
              <JoinClassForm />
            </div>
            <p className="text-xs text-muted-foreground">{TEACHER_SEES}</p>
          </section>
        </>
      )}
    </div>
  );
}

function ListSection({
  title,
  count,
  note,
  children,
}: {
  title: string;
  count?: number;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {title}
        {count !== undefined && <span className="ml-2 tabular-nums">· {count}</span>}
      </h2>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
      <ul className="divide-y divide-border border-y border-border">{children}</ul>
    </section>
  );
}

// Urgency is always in the words; weight and color only back them up.
const TONE_CLASS: Record<DueTone, string> = {
  overdue: "font-semibold text-destructive",
  soon: "font-semibold text-foreground",
  later: "text-muted-foreground",
  none: "text-muted-foreground",
};

// Where a row goes and what it says. Closed partway through has nothing left
// to do, so neither red nor "Start".
function describe(item: HomeworkItem, now: Date) {
  const closedEarly = item.closed && item.status === "IN_PROGRESS" && !item.readyToTurnIn;
  const due = describeDue(item.dueAt, now, { setBeforeJoining: item.setBeforeJoining });
  // Never red for work that's done or closed; describeDue already keeps
  // homework that was due before the student joined neutral.
  const tone: DueTone = item.status === "COMPLETED" || closedEarly ? "later" : due.tone;
  // Every question answered but not yet turned in: the session page turns it
  // in and shows the results, even if the teacher has since closed it.
  // Closed partway through goes to the homework's own page, which says so.
  const href =
    item.status === "COMPLETED" && item.sessionId
      ? `/homework/results/${item.sessionId}`
      : item.readyToTurnIn && item.sessionId
        ? `/homework/session/${item.sessionId}`
        : `/homework/${item.assignmentId}`;
  const action =
    item.status === "COMPLETED"
      ? "Review"
      : closedEarly
        ? "View"
        : item.readyToTurnIn
          ? "Turn in"
          : item.status === "IN_PROGRESS"
            ? "Continue"
            : "Start";
  const meta = `${item.className} · ${item.mode === "QUIZ" ? "Quiz · " : ""}${item.questionCount} question${item.questionCount === 1 ? "" : "s"}`;
  return { closedEarly, due, tone, href, action, meta };
}

function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// The one thing due next: a tint block with the due date in words, progress
// when started, and a single pill.
function NextUp({ item, now }: { item: HomeworkItem; now: Date }) {
  const { closedEarly, due, tone, href, action, meta } = describe(item, now);
  return (
    <section aria-label="Up next">
      <Link
        href={href}
        className="group block rounded-3xl bg-surface-tint p-6 transition-colors hover:bg-surface-tint/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:p-8"
      >
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Up next</p>
        <p className={cn("mt-3 font-heading text-2xl tracking-tight", TONE_CLASS[tone])}>{due.text}</p>
        <h2 className="mt-1 text-page-title sm:text-page-title-lg">{item.title}</h2>
        <p className="mt-2 text-muted-foreground">{meta}</p>
        {item.status === "IN_PROGRESS" && (
          <div className="mt-5 max-w-sm">
            <Bar value={item.answered} max={item.questionCount} label={`${item.title} progress`} />
            <p className="mt-1.5 text-sm text-muted-foreground tabular-nums">
              {closedEarly ? "Closed · " : ""}
              {item.answered} of {item.questionCount} answered
            </p>
          </div>
        )}
        <span className="mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-primary px-6 text-base font-medium text-primary-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none">
          {action}
          <ArrowRight className="size-5" aria-hidden />
        </span>
      </Link>
    </section>
  );
}

function HomeworkRow({ item, now }: { item: HomeworkItem; now: Date }) {
  const { closedEarly, due, tone, href, action, meta } = describe(item, now);
  const done = item.status === "COMPLETED";
  const pct = item.questionCount > 0 ? Math.round((item.correct / item.questionCount) * 100) : 0;
  return (
    <li>
      <Link
        href={href}
        className="group flex items-center justify-between gap-4 py-4 transition-colors hover:bg-muted/40 sm:px-2"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{item.title}</span>
          <span className="block text-sm text-muted-foreground">{meta}</span>
          {!done && <span className={cn("block text-sm", TONE_CLASS[tone])}>{due.text}</span>}
          {done && item.completedAt && (
            <span className="block text-sm text-muted-foreground">
              Finished {item.completedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
            </span>
          )}
          {item.status === "IN_PROGRESS" && (
            <span className="mt-2 block max-w-56">
              <Bar value={item.answered} max={item.questionCount} label={`${item.title} progress`} />
            </span>
          )}
        </span>
        <span className="shrink-0 text-right text-sm tabular-nums">
          {done ? (
            <>
              <span className="block font-heading text-xl font-semibold">
                {item.correct}
                <span className="text-base font-normal text-muted-foreground">/{item.questionCount}</span>
              </span>
              <span className="text-muted-foreground">{pct}%</span>
            </>
          ) : (
            <>
              <span className="block text-muted-foreground">
                {closedEarly
                  ? `Closed · ${item.answered} of ${item.questionCount} answered`
                  : item.status === "IN_PROGRESS"
                    ? `${item.answered}/${item.questionCount} answered`
                    : ""}
              </span>
              <span className="inline-flex items-center gap-1 font-medium text-primary">
                {action}
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                  aria-hidden
                />
              </span>
            </>
          )}
        </span>
      </Link>
    </li>
  );
}
