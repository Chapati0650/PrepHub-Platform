import { prisma } from "@/lib/prisma";
import { hasPaidAccess } from "@/lib/entitlements";

// Student-facing reads. Only published lessons exist from a student's point
// of view; a module with no published lessons is not shown at all.

export type SyllabusLesson = {
  id: string;
  title: string;
  description: string;
  durationSeconds: number | null;
  isFree: boolean;
  completed: boolean;
};

export type SyllabusModule = {
  id: string;
  title: string;
  lessons: SyllabusLesson[];
};

export type CurriculumOverview = {
  modules: SyllabusModule[];
  stats: { moduleCount: number; lessonCount: number; totalDurationSeconds: number; completedCount: number };
  /** The lesson "Start course" / "Continue" opens: first incomplete, else first. Null with no lessons. */
  nextLessonId: string | null;
  paidAccess: boolean;
};

export async function getCurriculumOverview(studentId: string): Promise<CurriculumOverview> {
  const [modules, progress, paidAccess] = await Promise.all([
    prisma.curriculumModule.findMany({
      orderBy: { position: "asc" },
      include: {
        lessons: {
          where: { publishedAt: { not: null } },
          orderBy: { position: "asc" },
          select: { id: true, title: true, description: true, durationSeconds: true, isFree: true },
        },
      },
    }),
    prisma.lessonProgress.findMany({ where: { studentId }, select: { lessonId: true } }),
    hasPaidAccess(studentId),
  ]);
  const done = new Set(progress.map((p) => p.lessonId));

  const visible: SyllabusModule[] = modules
    .filter((m) => m.lessons.length > 0)
    .map((m) => ({
      id: m.id,
      title: m.title,
      lessons: m.lessons.map((l) => ({ ...l, completed: done.has(l.id) })),
    }));

  const all = visible.flatMap((m) => m.lessons);
  const next = all.find((l) => !l.completed) ?? all[0] ?? null;

  return {
    modules: visible,
    stats: {
      moduleCount: visible.length,
      lessonCount: all.length,
      totalDurationSeconds: all.reduce((sum, l) => sum + (l.durationSeconds ?? 0), 0),
      completedCount: all.filter((l) => l.completed).length,
    },
    nextLessonId: next?.id ?? null,
    paidAccess,
  };
}

export type LessonView = {
  id: string;
  title: string;
  description: string;
  moduleTitle: string;
  durationSeconds: number | null;
  isFree: boolean;
  completed: boolean;
  /** False when the lesson is behind Premium and this student hasn't paid: the page renders the paywall, never the video. */
  canWatch: boolean;
  video: { source: "YOUTUBE"; videoId: string } | { source: "UPLOAD"; mediaAssetId: string } | null;
  prevLessonId: string | null;
  nextLessonId: string | null;
};

export async function getLessonForStudent(studentId: string, lessonId: string): Promise<LessonView | null> {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { module: { select: { title: true } }, mediaAsset: { select: { id: true, status: true } } },
  });
  if (!lesson || !lesson.publishedAt) return null;

  // Prev/next walk the published syllabus in display order, across modules.
  const [ordered, progress, paidAccess] = await Promise.all([
    prisma.lesson.findMany({
      where: { publishedAt: { not: null } },
      orderBy: [{ module: { position: "asc" } }, { position: "asc" }],
      select: { id: true },
    }),
    prisma.lessonProgress.findUnique({ where: { studentId_lessonId: { studentId, lessonId } } }),
    hasPaidAccess(studentId),
  ]);
  const index = ordered.findIndex((l) => l.id === lessonId);
  const canWatch = lesson.isFree || paidAccess;

  let video: LessonView["video"] = null;
  if (canWatch) {
    if (lesson.videoSource === "YOUTUBE" && lesson.youtubeVideoId) video = { source: "YOUTUBE", videoId: lesson.youtubeVideoId };
    else if (lesson.videoSource === "UPLOAD" && lesson.mediaAsset?.status === "READY") video = { source: "UPLOAD", mediaAssetId: lesson.mediaAsset.id };
  }

  return {
    id: lesson.id,
    title: lesson.title,
    description: lesson.description,
    moduleTitle: lesson.module.title,
    durationSeconds: lesson.durationSeconds,
    isFree: lesson.isFree,
    completed: progress !== null,
    canWatch,
    video,
    prevLessonId: index > 0 ? ordered[index - 1].id : null,
    nextLessonId: index >= 0 && index < ordered.length - 1 ? ordered[index + 1].id : null,
  };
}

// Recorded once. A second call is a no-op rather than an error so a double
// click on "Mark complete" is harmless.
export async function markLessonComplete(studentId: string, lessonId: string): Promise<void> {
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { publishedAt: true, isFree: true } });
  if (!lesson?.publishedAt) return;
  if (!lesson.isFree && !(await hasPaidAccess(studentId))) return;
  await prisma.lessonProgress.upsert({
    where: { studentId_lessonId: { studentId, lessonId } },
    create: { studentId, lessonId },
    update: {},
  });
}
