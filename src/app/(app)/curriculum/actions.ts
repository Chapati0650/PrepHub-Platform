"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { markLessonComplete } from "@/lib/curriculum/queries";

export async function markLessonCompleteAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || !canUseStudentExperience(session.user.role)) throw new Error("Not authorized.");
  const lessonId = formData.get("lessonId");
  if (typeof lessonId !== "string" || !lessonId) throw new Error("Lesson not found.");
  await markLessonComplete(session.user.id, lessonId);
  revalidatePath(`/curriculum/${lessonId}`);
  revalidatePath("/curriculum");
}
