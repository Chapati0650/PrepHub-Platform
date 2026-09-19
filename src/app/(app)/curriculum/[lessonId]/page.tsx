import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Lock } from "lucide-react";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { getLessonForStudent, getCurriculumOverview } from "@/lib/curriculum/queries";
import { youTubeEmbedUrl } from "@/lib/curriculum/youtube";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { markLessonCompleteAction } from "../actions";

export default async function LessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");
  const studentId = session.user.id;

  const { lessonId } = await params;
  const [lesson, course] = await Promise.all([getLessonForStudent(studentId, lessonId), getCurriculumOverview(studentId)]);
  if (!lesson) notFound();

  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 p-4 pb-16 sm:p-8 lg:grid-cols-[1fr_minmax(0,20rem)]">
      <div className="flex min-w-0 flex-col gap-6">
        <Link href="/curriculum" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden />
          Back to the Curriculum
        </Link>

        <div>
          <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">{lesson.moduleTitle}</p>
          <h1 className="mt-2 text-page-title sm:text-page-title-lg">{lesson.title}</h1>
        </div>

        {/* The player, or the paywall in its place. The video element is
            never rendered for a locked lesson — the gate is the data
            (LessonView.video is null), not a CSS overlay. */}
        {lesson.video ? (
          <div className="overflow-hidden rounded-2xl bg-black">
            {lesson.video.source === "YOUTUBE" ? (
              <iframe
                src={youTubeEmbedUrl(lesson.video.videoId)}
                title={lesson.title}
                className="aspect-video w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : (
              <video controls className="aspect-video w-full" src={`/api/media/${lesson.video.mediaAssetId}`} />
            )}
          </div>
        ) : !lesson.canWatch ? (
          <div className="flex aspect-video w-full flex-col items-start justify-center gap-4 rounded-2xl bg-surface-deep p-8 text-surface-deep-foreground">
            <span className="flex size-10 items-center justify-center rounded-full bg-surface-deep-foreground/10">
              <Lock className="size-5" aria-hidden />
            </span>
            <p className="font-heading text-xl font-semibold tracking-tight">This lesson is part of Premium.</p>
            <p className="max-w-md text-surface-deep-foreground/75">
              Premium opens every lesson in the Curriculum, plus unlimited Personalized Practice Sets and the 800 Club.
            </p>
            <LinkButton
              className="rounded-full bg-surface-deep-foreground px-5 text-surface-deep hover:bg-surface-deep-foreground/90"
              href="/pricing"
            >
              View plans
            </LinkButton>
          </div>
        ) : (
          <div className="flex aspect-video w-full items-center justify-center rounded-2xl bg-surface-tint text-sm text-muted-foreground">
            This lesson&apos;s video isn&apos;t available right now.
          </div>
        )}

        {lesson.description && <p className="max-w-prose text-muted-foreground">{lesson.description}</p>}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
          {lesson.canWatch &&
            (lesson.completed ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-surface-tint px-4 py-2 text-sm font-medium text-primary">
                <Check className="size-4" strokeWidth={3} aria-hidden />
                Completed
              </span>
            ) : (
              <form action={markLessonCompleteAction}>
                <input type="hidden" name="lessonId" value={lesson.id} />
                <Button type="submit" className="rounded-full px-5">
                  <Check className="size-4" aria-hidden />
                  Mark complete
                </Button>
              </form>
            ))}
          <div className="ml-auto flex gap-2">
            {lesson.prevLessonId && (
              <LinkButton variant="outline" className="rounded-full" href={`/curriculum/${lesson.prevLessonId}`}>
                <ArrowLeft className="size-4" aria-hidden />
                Previous
              </LinkButton>
            )}
            {lesson.nextLessonId && (
              <LinkButton variant="outline" className="rounded-full" href={`/curriculum/${lesson.nextLessonId}`}>
                Next
                <ArrowRight className="size-4" aria-hidden />
              </LinkButton>
            )}
          </div>
        </div>
      </div>

      {/* Syllabus rail */}
      <aside className="lg:sticky lg:top-8 lg:self-start">
        <p className="text-caption font-semibold tracking-[0.12em] text-muted-foreground uppercase">Syllabus</p>
        <div className="mt-3 flex flex-col gap-4">
          {course.modules.map((m) => (
            <div key={m.id}>
              <p className="mb-1 px-3 text-sm font-medium">{m.title}</p>
              <ol className="flex flex-col gap-0.5">
                {m.lessons.map((l) => {
                  const current = l.id === lesson.id;
                  return (
                    <li key={l.id}>
                      <Link
                        href={`/curriculum/${l.id}`}
                        aria-current={current ? "page" : undefined}
                        className={
                          current
                            ? "flex items-center gap-2.5 rounded-full bg-muted px-3 py-2 text-sm font-medium"
                            : "flex items-center gap-2.5 rounded-full px-3 py-2 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        }
                      >
                        <span
                          aria-hidden
                          className={
                            l.completed
                              ? "flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
                              : "size-4 shrink-0 rounded-full border border-foreground/25"
                          }
                        >
                          {l.completed && <Check className="size-2.5" strokeWidth={3} />}
                        </span>
                        <span className="truncate">{l.title}</span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
