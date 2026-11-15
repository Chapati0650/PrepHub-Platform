"use server";

import { redirect } from "next/navigation";
import { requireOwnedClassroom, requireTeacherAction } from "@/lib/teacher/access";
import { closeClassRushQuestion, createClassRush, endClassRush, startClassRush } from "@/lib/rush/class-rush";
import { isRushSection } from "@/lib/rush/config";

// The teacher's side of a Class Rush (lib/rush/class-rush.ts). Each action
// checks the teacher owns the class or the game; the screens only send ids.

export async function createClassRushAction(formData: FormData): Promise<void> {
  const context = await requireTeacherAction();
  const classroomId = String(formData.get("classroomId") ?? "");
  const section = String(formData.get("section") ?? "");
  const size = Number(formData.get("size"));
  const classroom = await requireOwnedClassroom(context, classroomId);
  if (classroom.archivedAt || !isRushSection(section)) redirect(`/teacher/classes/${classroomId}`);
  const rushId = await createClassRush(context, classroomId, { section, size });
  redirect(`/teacher/rush/${rushId}`);
}

export async function startClassRushAction(rushId: string): Promise<boolean> {
  const context = await requireTeacherAction();
  return startClassRush(context, String(rushId));
}

export async function closeClassRushQuestionAction(rushId: string): Promise<void> {
  const context = await requireTeacherAction();
  await closeClassRushQuestion(context, String(rushId));
}

export async function endClassRushAction(rushId: string): Promise<void> {
  const context = await requireTeacherAction();
  await endClassRush(context, String(rushId));
}
