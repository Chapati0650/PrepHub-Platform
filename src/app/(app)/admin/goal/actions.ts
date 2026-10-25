"use server";

import { revalidatePath } from "next/cache";
import { requireAdminWriteContext } from "@/lib/admin/school-context";
import { GoalError, parseGoalForm, saveCommunityGoal } from "@/lib/community/goal";
import type { GoalEditorState } from "@/components/community/goal-editor";

/**
 * An Administrator sets their own school's goal and prize (2026-10-24) — the
 * school is the one giving the prize, so it should be the one naming it. The
 * school comes from the Administrator's own assignment, never from the form,
 * so a hand-edited request can't touch another school. The Owner's preview of
 * this page is read-only, as with every admin write.
 */
export async function saveSchoolGoalAction(_prev: GoalEditorState, formData: FormData): Promise<GoalEditorState> {
  const context = await requireAdminWriteContext();
  if ("error" in context) return { error: context.error };

  const parsed = parseGoalForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  try {
    await saveCommunityGoal(context.schoolId, parsed);
  } catch (err) {
    if (err instanceof GoalError) return { error: err.message };
    throw err;
  }

  revalidatePath("/admin/goal");
  revalidatePath("/community");
  return { success: true };
}
