"use server";

import { revalidatePath } from "next/cache";
import { requireAdminWriteContext } from "@/lib/admin/school-context";
import { inviteTeacher, removeTeacher, resendTeacherInvite } from "@/lib/teacher/accounts";
import { TeacherError } from "@/lib/teacher/errors";
import type { TeacherPanelState } from "@/components/teacher/teachers-panel";

/**
 * An Administrator manages their own school's teachers. The school comes from
 * the Administrator's assignment, never from the request, so a hand-built
 * call can't add or remove a teacher anywhere else (GER §6). The Owner's
 * preview is read-only, like every admin write.
 */
async function adminSchool(): Promise<{ schoolId: string } | { error: string }> {
  const context = await requireAdminWriteContext();
  if ("error" in context) return context;
  return { schoolId: context.schoolId };
}

export async function inviteTeacherAction(_prev: TeacherPanelState, formData: FormData): Promise<TeacherPanelState> {
  const school = await adminSchool();
  if ("error" in school) return { error: school.error };
  try {
    const { created } = await inviteTeacher({
      firstName: String(formData.get("firstName") ?? ""),
      email: String(formData.get("email") ?? ""),
      schoolId: school.schoolId,
      invitedBy: "Your school's PrepHub administrator",
    });
    revalidatePath("/admin/teachers");
    return {
      success: true,
      message: created ? "Added. They'll get an email to set their password." : "Added back — their access is restored.",
    };
  } catch (err) {
    if (err instanceof TeacherError) return { error: err.message };
    throw err;
  }
}

export async function resendTeacherInviteAction(userId: string): Promise<TeacherPanelState> {
  const school = await adminSchool();
  if ("error" in school) return { error: school.error };
  try {
    await resendTeacherInvite(userId, school.schoolId, "Your school's PrepHub administrator");
    return { message: "Sent a new invite." };
  } catch (err) {
    if (err instanceof TeacherError) return { error: err.message };
    throw err;
  }
}

export async function removeTeacherAction(userId: string): Promise<TeacherPanelState> {
  const school = await adminSchool();
  if ("error" in school) return { error: school.error };
  await removeTeacher(userId, school.schoolId);
  revalidatePath("/admin/teachers");
  return { success: true };
}
