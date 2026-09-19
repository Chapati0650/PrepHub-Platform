import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, Lock, Play } from "lucide-react";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { getCurriculumOverview } from "@/lib/curriculum/queries";
import { LinkButton } from "@/components/ui/link-button";
import { Marker } from "@/components/ui/marker";
import { TeacherCard, TEACHER } from "./teacher-card";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// The Curriculum — the reference's "Masterclass": the Owner's video course.
// Overview, teacher and course facts are visible to every student; playing a
// lesson that isn't marked free needs paid access (decided in
// getLessonForStudent via hasPaidAccess, never here).
export default async function CurriculumPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");

  const course = await getCurriculumOverview(session.user.id);
  const started = course.stats.completedCount > 0;
  const finished = course.stats.lessonCount > 0 && course.stats.completedCount === course.stats.lessonCount;

  return (
    <div className="pb-16">
      {/* Hero band — the reference's illustrated header, on the surface-deep
          block the rest of the product uses for its brand moments. */}
      <div className="bg-surface-deep px-4 pt-10 pb-16 text-surface-deep-foreground sm:px-8 sm:pt-14 sm:pb-20">
        <div className="mx-auto max-w-5xl">
          <p className="text-caption font-semibold tracking-[0.12em] text-surface-deep-foreground/60 uppercase">
            Video course · {course.stats.lessonCount} lesson{course.stats.lessonCount === 1 ? "" : "s"}
          </p>
          <h1 className="mt-3 text-display-sm text-balance text-surface-deep-foreground sm:text-display">
            The <Marker>Curriculum</Marker>
          </h1>
          <p className="mt-4 max-w-xl text-lg text-surface-deep-foreground/75">
            Every SAT topic, taught by the person who built PrepHub — in the order that makes the rest of the
            product make sense.
          </p>
        </div>
      </div>

      <div className="mx-auto -mt-8 grid max-w-5xl grid-cols-1 gap-8 px-4 sm:px-8 lg:grid-cols-[1fr_minmax(0,22rem)] lg:gap-10">
        <div className="flex flex-col gap-8">
          {/* Course overview — the Owner's note to the student. Kept to
              claims the product can back: what the Diagnostic does, what the
              lessons are for. */}
          <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <h2 className="font-heading text-xl font-semibold tracking-tight">Course overview</h2>
            <div className="mt-4 flex flex-col gap-4 text-muted-foreground">
              <p>
                Most students don&apos;t have a gap in ability. They have a gap in system: they&apos;ve never been shown
                exactly how each SAT question type works and what the test is actually asking. This course closes
                that gap, one topic at a time.
              </p>
              <p>
                Each lesson is a focused video on one topic, in the same order PrepHub&apos;s categories run. Watch a
                lesson, then let your Personalized Practice Sets put it to work &mdash; the Diagnostic already knows
                which lessons will move your score the most.
              </p>
              <p>See you inside,</p>
              <p className="font-heading text-lg font-semibold tracking-tight text-foreground">{TEACHER.name.split(" ")[0]}</p>
            </div>

            <div className="mt-8 flex flex-col gap-4 rounded-2xl bg-surface-tint p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{finished ? "You've finished the course." : started ? "Pick up where you left off." : "Ready to start?"}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {course.stats.lessonCount === 0
                    ? "Lessons are being added."
                    : finished
                      ? "Every lesson is marked complete. Rewatch any of them below."
                      : started
                        ? `${course.stats.completedCount} of ${course.stats.lessonCount} lessons complete.`
                        : "Begin with the first lesson in the syllabus."}
                </p>
              </div>
              {course.nextLessonId && (
                <LinkButton size="cta" className="shrink-0" href={`/curriculum/${course.nextLessonId}`}>
                  <Play className="size-4" aria-hidden />
                  {started && !finished ? "Continue" : "Start course"}
                </LinkButton>
              )}
            </div>
          </section>

          {/* Syllabus */}
          <section className="flex flex-col gap-4">
            <h2 className="font-heading text-xl font-semibold tracking-tight">Syllabus</h2>
            {course.modules.length === 0 ? (
              <div className="rounded-2xl bg-surface-tint p-6 text-sm text-muted-foreground">
                The first lessons are being recorded. This page will fill in as they&apos;re published.
              </div>
            ) : (
              course.modules.map((m, mi) => (
                <div key={m.id} className="rounded-2xl border border-border">
                  <div className="flex items-baseline gap-4 border-b border-border px-5 py-4">
                    <span className="font-heading text-sm font-semibold tabular-nums text-muted-foreground">
                      {String(mi + 1).padStart(2, "0")}
                    </span>
                    <h3 className="font-heading font-semibold">{m.title}</h3>
                  </div>
                  <ol className="divide-y divide-border">
                    {m.lessons.map((l) => {
                      const locked = !l.isFree && !course.paidAccess;
                      return (
                        <li key={l.id}>
                          <Link
                            href={`/curriculum/${l.id}`}
                            className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/40"
                          >
                            <span
                              aria-hidden
                              className={
                                l.completed
                                  ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                                  : "flex size-6 shrink-0 items-center justify-center rounded-full border border-foreground/25 text-muted-foreground"
                              }
                            >
                              {l.completed ? <Check className="size-3.5" strokeWidth={3} /> : locked ? <Lock className="size-3" /> : <Play className="size-3" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{l.title}</span>
                              {l.description && <span className="block truncate text-sm text-muted-foreground">{l.description}</span>}
                            </span>
                            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                              {l.isFree && !course.paidAccess && <span className="mr-3 text-primary">Free</span>}
                              {l.durationSeconds ? formatDuration(l.durationSeconds) : ""}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))
            )}
          </section>
        </div>

        <div className="flex flex-col gap-6 lg:sticky lg:top-8 lg:self-start">
          <TeacherCard />

          <section className="rounded-2xl border border-border bg-card p-6">
            <h2 className="font-heading text-lg font-semibold tracking-tight">About this course</h2>
            <dl className="mt-4 flex flex-col divide-y divide-border text-sm">
              <Fact label="Modules" value={String(course.stats.moduleCount)} />
              <Fact label="Lessons" value={String(course.stats.lessonCount)} />
              <Fact label="Duration" value={course.stats.totalDurationSeconds > 0 ? formatDuration(course.stats.totalDurationSeconds) : "—"} />
              <Fact label="Language" value="English" />
            </dl>
          </section>

          {!course.paidAccess && course.stats.lessonCount > 0 && (
            <section className="rounded-2xl bg-surface-tint p-6">
              <p className="text-caption font-semibold tracking-[0.12em] text-primary uppercase">PrepHub Premium</p>
              <h2 className="mt-2 font-heading text-lg font-semibold tracking-tight">Unlock the full course.</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Premium opens every lesson, plus unlimited Personalized Practice Sets and the 800 Club.
              </p>
              <LinkButton className="mt-4 rounded-full px-5" href="/pricing">
                View plans
              </LinkButton>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
