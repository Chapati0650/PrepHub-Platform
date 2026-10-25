"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  createOrganization,
  updateOrganizationDetails,
  updateTotalEnrollment,
  activateOrganization,
  suspendOrganization,
  archiveOrganization,
  renewOrganization,
} from "@/lib/owner/organizations";
import { createAdministrator, removeAdministratorAssignment } from "@/lib/owner/administrators";
import {
  manuallyActivateStudent,
  removeMembership,
  restoreMembership,
  markGraduated,
  updateGraduationInfo,
  resolveSchoolTransfer,
} from "@/lib/owner/memberships";
import { OwnerError } from "@/lib/owner/errors";
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  updateTotalEnrollmentSchema,
  renewOrganizationSchema,
  createAdministratorSchema,
  manualActivationSchema,
  graduationInfoSchema,
  schoolTransferSchema,
} from "@/lib/validation/owner";
import { prisma } from "@/lib/prisma";
import { logUnauthorizedAccess } from "@/lib/logger";
import {
  RosterError,
  commitRosterUpload,
  previewRosterUpload,
  removeRosterEntry,
  setEnrollmentMode,
} from "@/lib/owner/roster";
import { sendRosterInvitations } from "@/lib/owner/roster-invites";
import { GoalError, parseGoalForm, saveCommunityGoal } from "@/lib/community/goal";
import { inviteTeacher, removeTeacher, resendTeacherInvite } from "@/lib/teacher/accounts";
import { TeacherError } from "@/lib/teacher/errors";
import type { TeacherPanelState } from "@/components/teacher/teachers-panel";

export type ActionState = { error?: string; success?: boolean };

/**
 * Reports the counts back, because "sent" with no number is the one thing
 * that would make the Owner click again to be sure — which is exactly the
 * double-send the resumable design exists to avoid.
 */
export type RosterInviteState = {
  error?: string;
  success?: boolean;
  queued?: number;
  remaining?: number;
};

async function requireOwner() {
  const session = await auth();
  if (session?.user.role !== "OWNER") {
    logUnauthorizedAccess("Non-Owner attempted an Owner-only schools action", {
      accountId: session?.user.id,
      role: session?.user.role,
    });
    redirect("/home");
  }
  return session;
}

function formEntries(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

export async function createOrganizationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

  const raw = formEntries(formData);
  const parsed = createOrganizationSchema.safeParse({
    ...raw,
    parentDistrictId: raw.parentDistrictId || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  let organization;
  try {
    organization = await createOrganization(parsed.data);
  } catch (err) {
    if (err instanceof OwnerError) return { error: err.message };
    throw err;
  }

  revalidatePath("/owner/schools");
  // "Add School" (from a District's own page) passes this so the Owner lands
  // back where they were, not on the brand-new, still-empty school's page.
  const returnTo = formData.get("returnTo");
  redirect(typeof returnTo === "string" && returnTo ? returnTo : `/owner/schools/${organization.id}`);
}

export async function updateOrganizationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing organization id." };

  const parsed = updateOrganizationSchema.safeParse(formEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    await updateOrganizationDetails(id, parsed.data);
  } catch (err) {
    if (err instanceof OwnerError) return { error: err.message };
    throw err;
  }

  revalidatePath(`/owner/schools/${id}`);
  return { success: true };
}

export async function updateCommunityGoalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireOwner();

  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing organization id." };

  // The same parser and rules the school's own Administrator is held to
  // (lib/community/goal.ts), so the two editors can't drift.
  const parsed = parseGoalForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  try {
    await saveCommunityGoal(id, parsed);
  } catch (err) {
    if (err instanceof GoalError) return { error: err.message };
    throw err;
  }

  revalidatePath(`/owner/schools/${id}`);
  revalidatePath("/community");
  return { success: true };
}

export async function updateTotalEnrollmentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireOwner();

  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing organization id." };

  const parsed = updateTotalEnrollmentSchema.safeParse(formEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const totalEnrollment = parsed.data.totalEnrollment ? Number(parsed.data.totalEnrollment) : null;
  if (totalEnrollment !== null && (!Number.isInteger(totalEnrollment) || totalEnrollment < 0)) {
    return { error: "Enter a whole number of 0 or more." };
  }

  try {
    await updateTotalEnrollment(id, totalEnrollment);
  } catch (err) {
    if (err instanceof OwnerError) return { error: err.message };
    throw err;
  }

  revalidatePath(`/owner/schools/${id}`);
  return { success: true };
}

export async function activateOrganizationAction(id: string): Promise<ActionState> {
  await requireOwner();
  try {
    await activateOrganization(id);
  } catch (err) {
    if (err instanceof OwnerError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/owner/schools/${id}`);
  revalidatePath("/owner/schools");
  return { success: true };
}

export async function suspendOrganizationAction(id: string): Promise<ActionState> {
  await requireOwner();
  try {
    await suspendOrganization(id);
  } catch (err) {
    if (err instanceof OwnerError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/owner/schools/${id}`);
  revalidatePath("/owner/schools");
  return { success: true };
}

export async function archiveOrganizationAction(id: string): Promise<ActionState> {
  await requireOwner();
  try {
    await archiveOrganization(id);
  } catch (err) {
    if (err instanceof OwnerError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/owner/schools/${id}`);
  revalidatePath("/owner/schools");
  return { success: true };
}

export async function renewOrganizationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { error: "Missing organization id." };

  const parsed = renewOrganizationSchema.safeParse(formEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    await renewOrganization(id, parsed.data.contractStartDate, parsed.data.contractEndDate);
  } catch (err) {
    if (err instanceof OwnerError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/owner/schools/${id}`);
  return { success: true };
}

export async function createAdministratorAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

  const organizationId = formData.get("organizationId");
  if (typeof organizationId !== "string" || !organizationId) {
    return { error: "Missing organization id." };
  }

  const parsed = createAdministratorSchema.safeParse(formEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    await createAdministrator({ ...parsed.data, organizationId });
  } catch (err) {
    if (err instanceof OwnerError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/owner/schools/${organizationId}`);
  return { success: true };
}

export async function removeAdministratorAssignmentAction(
  assignmentId: string,
  organizationId: string,
): Promise<ActionState> {
  await requireOwner();
  try {
    await removeAdministratorAssignment(assignmentId);
  } catch (err) {
    if (err instanceof OwnerError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/owner/schools/${organizationId}`);
  return { success: true };
}

export async function manuallyActivateStudentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

  const organizationId = formData.get("organizationId");
  if (typeof organizationId !== "string" || !organizationId) {
    return { error: "Missing organization id." };
  }

  const parsed = manualActivationSchema.safeParse(formEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    await manuallyActivateStudent({ ...parsed.data, organizationId });
  } catch (err) {
    if (err instanceof OwnerError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/owner/schools/${organizationId}`);
  return { success: true };
}

export async function removeMembershipAction(
  membershipId: string,
  organizationId: string,
): Promise<ActionState> {
  const session = await requireOwner();
  try {
    await removeMembership(membershipId, session.user.id);
  } catch (err) {
    if (err instanceof OwnerError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/owner/schools/${organizationId}`);
  return { success: true };
}

export async function restoreMembershipAction(
  membershipId: string,
  organizationId: string,
): Promise<ActionState> {
  const session = await requireOwner();
  try {
    await restoreMembership(membershipId, session.user.id);
  } catch (err) {
    if (err instanceof OwnerError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/owner/schools/${organizationId}`);
  return { success: true };
}

export async function markGraduatedAction(
  membershipId: string,
  organizationId: string,
): Promise<ActionState> {
  const session = await requireOwner();
  try {
    await markGraduated(membershipId, session.user.id);
  } catch (err) {
    if (err instanceof OwnerError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/owner/schools/${organizationId}`);
  return { success: true };
}

export async function updateGraduationInfoAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

  const membershipId = formData.get("membershipId");
  const organizationId = formData.get("organizationId");
  if (typeof membershipId !== "string" || !membershipId) return { error: "Missing membership id." };
  if (typeof organizationId !== "string" || !organizationId) return { error: "Missing organization id." };

  const parsed = graduationInfoSchema.safeParse(formEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    await updateGraduationInfo(membershipId, parsed.data.currentGrade, parsed.data.expectedGraduationYear);
  } catch (err) {
    if (err instanceof OwnerError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/owner/schools/${organizationId}`);
  return { success: true };
}

export async function resolveSchoolTransferAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireOwner();

  const membershipId = formData.get("membershipId");
  const currentOrganizationId = formData.get("organizationId");
  const newDistrictId = formData.get("newDistrictId");
  if (typeof membershipId !== "string" || !membershipId) return { error: "Missing membership id." };
  if (typeof currentOrganizationId !== "string" || !currentOrganizationId) {
    return { error: "Missing organization id." };
  }

  const parsed = schoolTransferSchema.safeParse(formEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  // A school's own row IS its organizationId unless it belongs to a District,
  // in which case membership.organizationId must be the District, not the school.
  const newOrganizationId =
    typeof newDistrictId === "string" && newDistrictId ? newDistrictId : parsed.data.newSchoolId;

  try {
    await resolveSchoolTransfer(
      membershipId,
      newOrganizationId,
      parsed.data.newSchoolId,
      parsed.data.newVerifiedSchoolEmail,
      session.user.id,
    );
  } catch (err) {
    if (err instanceof OwnerError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/owner/schools/${currentOrganizationId}`);
  return { success: true };
}

// ---- Roster ----------------------------------------------------------------

export type RosterPreviewState = {
  error?: string;
  preview?: {
    toAdd: number;
    toUpdate: number;
    untouched: number;
    alreadyRegistered: number;
    headerless: boolean;
    sample: { email: string; campusName: string; firstName: string | null; graduationYear: number | null }[];
    errors: { line: number; value: string; reason: string }[];
    validCount: number;
  };
  /** Echoed back so the confirm step commits exactly what was previewed. */
  input?: string;
};

/** Dry run: shows the Owner what an upload would do before anything is written. */
export async function previewRosterAction(
  _prev: RosterPreviewState,
  formData: FormData,
): Promise<RosterPreviewState> {
  await requireOwner();
  const id = String(formData.get("id") ?? "");
  const input = String(formData.get("roster") ?? "");
  if (!input.trim()) return { error: "Paste a roster first." };

  try {
    const p = await previewRosterUpload(id, input);
    const byId = new Map(p.campuses.map((c) => [c.id, c.officialName]));
    return {
      input,
      preview: {
        toAdd: p.toAdd,
        toUpdate: p.toUpdate,
        untouched: p.untouched,
        alreadyRegistered: p.alreadyRegistered,
        headerless: p.parsed.headerless,
        validCount: p.parsed.rows.length,
        // Enough to eyeball that the columns were read the way the Owner meant.
        sample: p.parsed.rows.slice(0, 5).map((r) => ({
          email: r.email,
          campusName: byId.get(r.schoolId) ?? r.schoolId,
          firstName: r.firstName,
          graduationYear: r.graduationYear,
        })),
        errors: p.parsed.errors.slice(0, 25),
      },
    };
  } catch (err) {
    if (err instanceof RosterError) return { error: err.message };
    throw err;
  }
}

export async function commitRosterAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireOwner();
  const id = String(formData.get("id") ?? "");
  const input = String(formData.get("roster") ?? "");
  try {
    await commitRosterUpload(id, input);
  } catch (err) {
    if (err instanceof RosterError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/owner/schools/${id}`);
  return { success: true };
}

export async function removeRosterEntryAction(formData: FormData): Promise<void> {
  await requireOwner();
  const id = String(formData.get("id") ?? "");
  await removeRosterEntry(id, String(formData.get("entryId") ?? ""));
  revalidatePath(`/owner/schools/${id}`);
}

export async function setEnrollmentModeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireOwner();
  const id = String(formData.get("id") ?? "");
  try {
    await setEnrollmentMode(id, String(formData.get("enrollmentMode") ?? ""));
  } catch (err) {
    if (err instanceof RosterError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/owner/schools/${id}`);
  return { success: true };
}

/**
 * Emails the roster students who haven't claimed their access yet.
 *
 * `reminder` distinguishes the first invitation from chasing the people who
 * ignored it; both are capped per click and resumable, so a district of
 * thousands is several clicks rather than one request that times out.
 */
export async function sendRosterInvitesAction(
  _prev: RosterInviteState,
  formData: FormData,
): Promise<RosterInviteState> {
  await requireOwner();
  const id = String(formData.get("id") ?? "");
  try {
    const result = await sendRosterInvitations(
      { organizationId: id },
      { reminder: formData.get("reminder") === "1" },
    );
    revalidatePath(`/owner/schools/${id}`);
    return { success: true, queued: result.queued, remaining: result.remaining };
  } catch (err) {
    if (err instanceof RosterError) return { error: err.message };
    throw err;
  }
}

/**
 * Turns the weekly 1v1 Rush leaderboard on or off for a school or a district.
 * Owner-only, like every action in this file.
 */
export async function setRushLeaderboardAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireOwner();
  const id = String(formData.get("id") ?? "");
  const exists = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { error: "That organization no longer exists." };
  await prisma.organization.update({
    where: { id },
    data: { rushLeaderboardEnabled: formData.get("enabled") === "on" },
  });
  revalidatePath(`/owner/schools/${id}`);
  revalidatePath("/rush");
  return { success: true };
}

/** Sets or clears the mark this organization's students see in the sidebar. */
export async function setOrganizationLogoAction(id: string, logoMediaId: string | null): Promise<void> {
  await requireOwner();
  await prisma.organization.update({ where: { id }, data: { logoMediaId } });
  revalidatePath(`/owner/schools/${id}`);
  // Students see it in the app shell, which every authenticated route renders.
  revalidatePath("/", "layout");
}

// ---- Teachers (2026-10-24) -----------------------------------------------------
// The same operations a school's Administrator has, for the Owner setting a
// school up. The organization id comes first so the page can bind it.

export async function inviteTeacherOwnerAction(_prev: TeacherPanelState, formData: FormData): Promise<TeacherPanelState> {
  await requireOwner();
  const organizationId = String(formData.get("organizationId") ?? "");
  try {
    const { created } = await inviteTeacher({
      firstName: String(formData.get("firstName") ?? ""),
      email: String(formData.get("email") ?? ""),
      schoolId: organizationId,
      invitedBy: "The PrepHub team",
    });
    revalidatePath(`/owner/schools/${organizationId}`);
    return {
      success: true,
      message: created ? "Added. They'll get an email to set their password." : "Added back — their access is restored.",
    };
  } catch (err) {
    if (err instanceof TeacherError) return { error: err.message };
    throw err;
  }
}

export async function resendTeacherInviteOwnerAction(organizationId: string, userId: string): Promise<TeacherPanelState> {
  await requireOwner();
  try {
    await resendTeacherInvite(userId, organizationId, "The PrepHub team");
    return { message: "Sent a new invite." };
  } catch (err) {
    if (err instanceof TeacherError) return { error: err.message };
    throw err;
  }
}

export async function removeTeacherOwnerAction(organizationId: string, userId: string): Promise<TeacherPanelState> {
  await requireOwner();
  await removeTeacher(userId, organizationId);
  revalidatePath(`/owner/schools/${organizationId}`);
  return { success: true };
}
