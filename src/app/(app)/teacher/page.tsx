import Link from "next/link";
import { getTeacherContext, requireTeacherSession } from "@/lib/teacher/access";
import { listClassrooms } from "@/lib/teacher/classrooms";
import { formatJoinCode } from "@/lib/teacher/join-code";
import { PageHeader } from "@/components/page-header";
import { NewClassForm } from "./new-class-form";

// A teacher's home: their classes, and making a new one. Teachers land here
// from /home (they have no student dashboard of their own).
export default async function TeacherHomePage() {
  const userId = await requireTeacherSession();
  const context = await getTeacherContext(userId);

  // Removed by their school: the classes still exist, but this account can't
  // open them. Said plainly rather than shown as an empty list, which would
  // read as "your classes are gone".
  if (!context) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4 p-6 sm:p-10">
        <div className="rounded-3xl bg-surface-tint p-6 sm:p-8">
          <h1 className="text-page-title">Your teaching access has ended.</h1>
          <p className="mt-3 text-muted-foreground">
            Your school has removed this account&apos;s teacher access. Your classes and your students&apos; work
            are kept. If this is a mistake, ask your school&apos;s PrepHub administrator to add you back.
          </p>
        </div>
      </div>
    );
  }

  const classes = await listClassrooms(context);
  const open = classes.filter((c) => !c.archived);
  const archived = classes.filter((c) => c.archived);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 p-4 pb-16 sm:p-8">
      <PageHeader eyebrow={context.schoolName} title={`Your classes, ${context.firstName}`} />

      {open.length === 0 ? (
        <section className="rounded-3xl bg-surface-tint p-6 sm:p-8">
          <h2 className="text-xl font-semibold">Start with a class.</h2>
          <ol className="mt-4 flex flex-col gap-3 text-muted-foreground">
            <li className="flex gap-3">
              <span className="font-heading font-semibold text-foreground tabular-nums">01</span>
              Name it — &ldquo;3rd period SAT Prep&rdquo; is plenty.
            </li>
            <li className="flex gap-3">
              <span className="font-heading font-semibold text-foreground tabular-nums">02</span>
              Give your students its code. They join from their own PrepHub account.
            </li>
            <li className="flex gap-3">
              <span className="font-heading font-semibold text-foreground tabular-nums">03</span>
              Assign questions from the bank as homework, and see how each student did.
            </li>
          </ol>
          <div className="mt-6 max-w-md">
            <NewClassForm />
          </div>
        </section>
      ) : (
        <>
          <ul className="grid gap-4 sm:grid-cols-2">
            {open.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/teacher/classes/${c.id}`}
                  className="flex h-full flex-col gap-4 rounded-2xl border border-border p-5 transition-colors hover:border-foreground/30"
                >
                  <span className="text-lg font-semibold">{c.name}</span>
                  <span className="flex divide-x divide-border text-sm">
                    <span className="pr-4">
                      <span className="block font-heading text-2xl font-semibold tabular-nums">{c.studentCount}</span>
                      <span className="text-muted-foreground">student{c.studentCount === 1 ? "" : "s"}</span>
                    </span>
                    <span className="px-4">
                      <span className="block font-heading text-2xl font-semibold tabular-nums">{c.assignmentCount}</span>
                      <span className="text-muted-foreground">assignment{c.assignmentCount === 1 ? "" : "s"}</span>
                    </span>
                    <span className="pl-4">
                      <span className="block font-mono text-lg font-semibold tracking-wider">{formatJoinCode(c.joinCode)}</span>
                      <span className="text-muted-foreground">class code</span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <section className="flex max-w-md flex-col gap-3">
            <h2 className="text-sm font-semibold">New class</h2>
            <NewClassForm />
          </section>
        </>
      )}

      {archived.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Archived</h2>
          <ul className="divide-y divide-border border-y border-border">
            {archived.map((c) => (
              <li key={c.id}>
                <Link href={`/teacher/classes/${c.id}`} className="flex items-center justify-between py-3 text-sm hover:underline">
                  <span>{c.name}</span>
                  <span className="text-muted-foreground">
                    {c.studentCount} student{c.studentCount === 1 ? "" : "s"} · {c.assignmentCount} assignment
                    {c.assignmentCount === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
