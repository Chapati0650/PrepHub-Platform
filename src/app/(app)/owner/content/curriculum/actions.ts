"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { logUnauthorizedAccess } from "@/lib/logger";
import {
  CurriculumError,
  createLesson,
  createModule,
  deleteLesson,
  deleteModule,
  moveLesson,
  moveModule,
  renameModule,
  setLessonPublished,
  updateLesson,
  type LessonInput,
} from "@/lib/curriculum/owner";

export type CurriculumActionState = { error?: string; saved?: boolean };

async function requireOwner() {
  const session = await auth();
  if (session?.user.role !== "OWNER") {
    logUnauthorizedAccess("Non-Owner attempted an Owner-only curriculum action", {
      accountId: session?.user.id,
      role: session?.user.role,
    });
    redirect("/home");
  }
}

function refresh(lessonId?: string) {
  revalidatePath("/owner/content/curriculum");
  if (lessonId) revalidatePath(`/owner/content/curriculum/${lessonId}`);
  revalidatePath("/curriculum");
}

// Every student-facing error message below is the CurriculumError text —
// written for the Owner, who is the only person who can trigger these.
// Anything else is a real failure and is rethrown so instrumentation sees it.
function toState(err: unknown): CurriculumActionState {
  if (err instanceof CurriculumError) return { error: err.message };
  throw err;
}

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

// ---- Modules ---------------------------------------------------------------

export async function createModuleAction(_prev: CurriculumActionState, formData: FormData): Promise<CurriculumActionState> {
  await requireOwner();
  try {
    await createModule(str(formData, "title"));
  } catch (err) {
    return toState(err);
  }
  refresh();
  return { saved: true };
}

export async function renameModuleAction(_prev: CurriculumActionState, formData: FormData): Promise<CurriculumActionState> {
  await requireOwner();
  try {
    await renameModule(str(formData, "moduleId"), str(formData, "title"));
  } catch (err) {
    return toState(err);
  }
  refresh();
  return { saved: true };
}

export async function moveModuleAction(formData: FormData): Promise<void> {
  await requireOwner();
  const direction = str(formData, "direction");
  if (direction !== "up" && direction !== "down") return;
  await moveModule(str(formData, "moduleId"), direction);
  refresh();
}

export async function deleteModuleAction(formData: FormData): Promise<void> {
  await requireOwner();
  await deleteModule(str(formData, "moduleId"));
  refresh();
}

// ---- Lessons ---------------------------------------------------------------

export async function createLessonAction(_prev: CurriculumActionState, formData: FormData): Promise<CurriculumActionState> {
  await requireOwner();
  let lessonId: string;
  try {
    lessonId = (await createLesson(str(formData, "moduleId"), str(formData, "title"))).id;
  } catch (err) {
    return toState(err);
  }
  refresh();
  redirect(`/owner/content/curriculum/${lessonId}`);
}

export async function updateLessonAction(_prev: CurriculumActionState, formData: FormData): Promise<CurriculumActionState> {
  await requireOwner();
  const lessonId = str(formData, "lessonId");
  const minutesRaw = str(formData, "durationMinutes").trim();
  const input: LessonInput = {
    title: str(formData, "title"),
    description: str(formData, "description"),
    videoSource: str(formData, "videoSource") === "UPLOAD" ? "UPLOAD" : "YOUTUBE",
    youtubeUrl: str(formData, "youtubeUrl"),
    mediaAssetId: str(formData, "mediaAssetId") || null,
    durationMinutes: minutesRaw ? Number(minutesRaw) : null,
    isFree: formData.get("isFree") === "on",
  };
  try {
    await updateLesson(lessonId, input);
  } catch (err) {
    return toState(err);
  }
  refresh(lessonId);
  return { saved: true };
}

export async function moveLessonAction(formData: FormData): Promise<void> {
  await requireOwner();
  const direction = str(formData, "direction");
  if (direction !== "up" && direction !== "down") return;
  await moveLesson(str(formData, "lessonId"), direction);
  refresh();
}

export async function deleteLessonAction(formData: FormData): Promise<void> {
  await requireOwner();
  await deleteLesson(str(formData, "lessonId"));
  refresh();
  redirect("/owner/content/curriculum");
}

export async function setLessonPublishedAction(_prev: CurriculumActionState, formData: FormData): Promise<CurriculumActionState> {
  await requireOwner();
  const lessonId = str(formData, "lessonId");
  try {
    await setLessonPublished(lessonId, str(formData, "published") === "true");
  } catch (err) {
    return toState(err);
  }
  refresh(lessonId);
  return { saved: true };
}
