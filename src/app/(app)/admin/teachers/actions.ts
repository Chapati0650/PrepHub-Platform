"use server";

import { revalidatePath } from "next/cache";
import { requireAdminWriteContext } from "@/lib/admin/school-context";
import { inviteTeacher, removeTeacher, resendTeacherInvite } from "@/lib/teacher/accounts";
import { TeacherError } from "@/lib/teacher/errors";
import { logServerError } from "@/lib/logger";
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
    const { created, restoredClasses } = await inviteTeacher({
      firstName: String(formData.get("firstName") ?? ""),
      email: String(formData.get("email") ?? ""),
      schoolId: school.schoolId,
      invitedBy: "Your school's PrepHub administrator",
    });
    revalidatePath("/admin/teachers");
    return { success: true, message: inviteMessage(created, restoredClasses) };
  } catch (err) {
    // Nothing to do, and nothing went wrong: say so as a note, not an error.
    if (err instanceof TeacherError && err.code === "ALREADY_TEACHER") return { success: true, message: err.message };
    if (err instanceof TeacherError) return { error: err.message };
    throw err;
  }
}

function inviteMessage(created: boolean, restoredClasses: number): string {
  if (created) return "Added. They'll get an email to set their password.";
  if (restoredClasses === 0) return "Added back — their access is restored.";
  return `Added back — their access is restored, and the ${restoredClasses === 1 ? "class" : `${restoredClasses} classes`} closed when they were removed ${restoredClasses === 1 ? "is" : "are"} open again.`;
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
  try {
    await removeTeacher(userId, school.schoolId);
  } catch (err) {
    // Returned, not thrown, so the confirmation dialog can show it: in
    // production a thrown message is replaced with a generic one. Both writes
    // are one transaction, so a failure changed nothing.
    logServerError("Removing a teacher failed", {
      organizationId: school.schoolId,
      affectedResourceId: userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: "Couldn't remove this teacher just now, and nothing was changed. Try again in a moment." };
  }
  revalidatePath("/admin/teachers");
  return { success: true };
}
