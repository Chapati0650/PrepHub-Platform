import { prisma } from "@/lib/prisma";
import { moveItem, nextPosition } from "./ordering";
import { parseYouTubeVideoId } from "./youtube";

// Owner-only mutations. Authorization is the caller's job (the server actions
// in src/app/(app)/owner/content/curriculum/actions.ts call requireOwner);
// these assume it and do the work.

export class CurriculumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CurriculumError";
  }
}

function cleanTitle(title: string): string {
  const t = title.trim();
  if (!t) throw new CurriculumError("A title is required.");
  if (t.length > 120) throw new CurriculumError("Titles are limited to 120 characters.");
  return t;
}

// ---- Modules --------------------------------------------------------------

export async function createModule(title: string) {
  const existing = await prisma.curriculumModule.findMany({ select: { id: true, position: true } });
  return prisma.curriculumModule.create({ data: { title: cleanTitle(title), position: nextPosition(existing) } });
}

export async function renameModule(id: string, title: string) {
  return prisma.curriculumModule.update({ where: { id }, data: { title: cleanTitle(title) } });
}

export async function moveModule(id: string, direction: "up" | "down") {
  const all = await prisma.curriculumModule.findMany({ select: { id: true, position: true } });
  const next = moveItem(all, id, direction);
  await prisma.$transaction(next.map((m) => prisma.curriculumModule.update({ where: { id: m.id }, data: { position: m.position } })));
}

// Cascades to its lessons and their progress rows (schema onDelete). Real
// deletion rather than a soft delete: a module is Owner-authored structure,
// not student data, and nothing historical references it.
export async function deleteModule(id: string) {
  await prisma.curriculumModule.delete({ where: { id } });
}

// ---- Lessons --------------------------------------------------------------

export type LessonInput = {
  title: string;
  description: string;
  videoSource: "YOUTUBE" | "UPLOAD";
  youtubeUrl: string;
  mediaAssetId: string | null;
  durationMinutes: number | null;
  isFree: boolean;
};

function normalizeLessonInput(input: LessonInput) {
  const title = cleanTitle(input.title);
  const description = input.description.trim().slice(0, 2000);
  const durationSeconds =
    input.durationMinutes !== null && Number.isFinite(input.durationMinutes) && input.durationMinutes > 0
      ? Math.round(input.durationMinutes * 60)
      : null;

  let youtubeVideoId: string | null = null;
  let mediaAssetId: string | null = null;
  if (input.videoSource === "YOUTUBE") {
    if (input.youtubeUrl.trim()) {
      youtubeVideoId = parseYouTubeVideoId(input.youtubeUrl);
      if (!youtubeVideoId) throw new CurriculumError("That doesn't look like a YouTube link. Paste the video's URL or its 11-character id.");
    }
  } else {
    mediaAssetId = input.mediaAssetId;
  }
  return { title, description, videoSource: input.videoSource, youtubeVideoId, mediaAssetId, durationSeconds, isFree: input.isFree };
}

export async function createLesson(moduleId: string, title: string) {
  const siblings = await prisma.lesson.findMany({ where: { moduleId }, select: { id: true, position: true } });
  return prisma.lesson.create({ data: { moduleId, title: cleanTitle(title), position: nextPosition(siblings) } });
}

export async function updateLesson(id: string, input: LessonInput) {
  const data = normalizeLessonInput(input);
  if (data.videoSource === "UPLOAD" && data.mediaAssetId) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id: data.mediaAssetId }, select: { kind: true } });
    if (!asset || asset.kind !== "VIDEO") throw new CurriculumError("The uploaded file isn't a video.");
  }
  return prisma.lesson.update({ where: { id }, data });
}

export async function moveLesson(id: string, direction: "up" | "down") {
  const lesson = await prisma.lesson.findUnique({ where: { id }, select: { moduleId: true } });
  if (!lesson) return;
  const siblings = await prisma.lesson.findMany({ where: { moduleId: lesson.moduleId }, select: { id: true, position: true } });
  const next = moveItem(siblings, id, direction);
  await prisma.$transaction(next.map((l) => prisma.lesson.update({ where: { id: l.id }, data: { position: l.position } })));
}

export async function deleteLesson(id: string) {
  await prisma.lesson.delete({ where: { id } });
}

// A lesson can't be published without something to play. Unpublishing
// keeps LessonProgress rows — a student who finished it did finish it.
export async function setLessonPublished(id: string, published: boolean) {
  if (published) {
    const lesson = await prisma.lesson.findUnique({ where: { id }, include: { mediaAsset: { select: { status: true } } } });
    if (!lesson) throw new CurriculumError("Lesson not found.");
    const hasVideo =
      (lesson.videoSource === "YOUTUBE" && !!lesson.youtubeVideoId) ||
      (lesson.videoSource === "UPLOAD" && lesson.mediaAsset?.status === "READY");
    if (!hasVideo) throw new CurriculumError("Add a video before publishing this lesson.");
  }
  return prisma.lesson.update({ where: { id }, data: { publishedAt: published ? new Date() : null } });
}

// ---- Reads for the CMS ----------------------------------------------------

export async function getCurriculumForOwner() {
  return prisma.curriculumModule.findMany({
    orderBy: { position: "asc" },
    include: {
      lessons: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          position: true,
          videoSource: true,
          youtubeVideoId: true,
          mediaAssetId: true,
          durationSeconds: true,
          isFree: true,
          publishedAt: true,
        },
      },
    },
  });
}

export async function getLessonForOwner(id: string) {
  return prisma.lesson.findUnique({
    where: { id },
    include: { module: { select: { id: true, title: true } }, mediaAsset: { select: { id: true, status: true, originalFilename: true, failureReason: true } } },
  });
}
