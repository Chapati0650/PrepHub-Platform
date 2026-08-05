"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  createOrganization,
  updateOrganizationDetails,
  updateCommunityGoal,
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
  updateCommunityGoalSchema,
  updateTotalEnrollmentSchema,
  renewOrganizationSchema,
  createAdministratorSchema,
  manualActivationSchema,
  graduationInfoSchema,
  schoolTransferSchema,
} from "@/lib/validation/owner";
import { logUnauthorizedAccess } from "@/lib/logger";

export type ActionState = { error?: string; success?: boolean };

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

  const parsed = updateCommunityGoalSchema.safeParse(formEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const metric = parsed.data.communityGoalMetric === "" ? null : parsed.data.communityGoalMetric;
  const target = parsed.data.communityGoalTarget ? Number(parsed.data.communityGoalTarget) : null;
  if (metric && (!Number.isInteger(target) || (target as number) <= 0)) {
    return { error: "Enter a goal target greater than zero." };
  }

  try {
    await updateCommunityGoal(id, { communityGoalMetric: metric, communityGoalTarget: target });
  } catch (err) {
    if (err instanceof OwnerError) return { error: err.message };
    throw err;
  }

  revalidatePath(`/owner/schools/${id}`);
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
