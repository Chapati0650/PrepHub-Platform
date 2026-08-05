"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { updateStudentInfo } from "@/lib/admin/student-directory";
import { AdminError } from "@/lib/admin/errors";
import { updateStudentInfoSchema } from "@/lib/validation/admin";

export type ActionState = { error?: string; success?: boolean };

function formEntries(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

export async function updateStudentInfoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { schoolId } = await requireAdminSchoolContext();
  if (!schoolId) return { error: "Not authorized." };

  const membershipId = formData.get("membershipId");
  if (typeof membershipId !== "string" || !membershipId) return { error: "Missing student id." };

  const parsed = updateStudentInfoSchema.safeParse(formEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    await updateStudentInfo(schoolId, membershipId, parsed.data);
  } catch (err) {
    if (err instanceof AdminError) return { error: err.message };
    throw err;
  }

  revalidatePath("/admin/students");
  return { success: true };
}
