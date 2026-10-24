"use server";

import { revalidatePath } from "next/cache";
import { requireAdminWriteContext } from "@/lib/admin/school-context";
import { updateStudentInfo } from "@/lib/admin/student-directory";
import { AdminError } from "@/lib/admin/errors";
import { updateStudentInfoSchema } from "@/lib/validation/admin";
import { RosterError } from "@/lib/owner/roster";
import { inviteScopeForSchool, sendRosterInvitations } from "@/lib/owner/roster-invites";

export type ActionState = { error?: string; success?: boolean };

function formEntries(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

export async function updateStudentInfoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireAdminWriteContext();
  if ("error" in context) return context;
  const { schoolId } = context;

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

export type InviteState = {
  error?: string;
  success?: boolean;
  queued?: number;
  remaining?: number;
};

/**
 * Emails the campus's rostered students who haven't signed up yet.
 *
 * Scoped by `inviteScopeForSchool`, which resolves the administrator's own
 * campus to the organization that owns its roster — so an administrator can
 * never reach another campus's students, including the sibling campuses of
 * their own district. `requireAdminWriteContext` is what refuses the Owner's
 * read-only preview; the Owner has their own send on the school detail page.
 */
export async function sendCampusInvitesAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const context = await requireAdminWriteContext();
  if ("error" in context) return context;

  try {
    const scope = await inviteScopeForSchool(context.schoolId);
    const result = await sendRosterInvitations(scope, { reminder: formData.get("reminder") === "1" });
    revalidatePath("/admin/students");
    return { success: true, queued: result.queued, remaining: result.remaining };
  } catch (err) {
    if (err instanceof RosterError) return { error: err.message };
    throw err;
  }
}
