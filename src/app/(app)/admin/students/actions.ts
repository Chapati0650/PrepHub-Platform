"use server";

import { revalidatePath } from "next/cache";
import { requireAdminWriteContext, schoolField } from "@/lib/admin/school-context";
import { parseDirectoryFilters, updateStudentInfo } from "@/lib/admin/student-directory";
import {
  REMINDER_MAX_RECIPIENTS,
  previewReminderAudience,
  sendStudentReminders,
  type ReminderPreview,
  type ReminderTarget,
} from "@/lib/admin/student-reminders";
import { cleanReminderInput } from "@/lib/admin/reminder-message";
import { prisma } from "@/lib/prisma";
import { AdminError } from "@/lib/admin/errors";
import { updateStudentInfoSchema } from "@/lib/validation/admin";
import { RosterError } from "@/lib/owner/roster";
import { inviteScopeForSchool, sendRosterInvitations } from "@/lib/owner/roster-invites";
import { DEMO_LOCKED_MESSAGE, isDemoSession } from "@/lib/demo-guard";

export type ActionState = { error?: string; success?: boolean };

function formEntries(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

export async function updateStudentInfoAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (await isDemoSession()) return { error: DEMO_LOCKED_MESSAGE };
  const context = await requireAdminWriteContext(schoolField(formData));
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

/**
 * What the composer sends: the list's own query string (its filters, read
 * again on the server) or the students ticked on the page. Server actions
 * accept whatever the browser sends, so every field is checked here.
 */
export type ReminderRequest = {
  school: string | null;
  filtersQuery: string;
  membershipIds: string[] | null;
};

function reminderTarget(request: ReminderRequest): ReminderTarget | null {
  if (Array.isArray(request?.membershipIds)) {
    const ids = request.membershipIds.filter((id): id is string => typeof id === "string").slice(0, REMINDER_MAX_RECIPIENTS + 1);
    return ids.length > 0 ? { kind: "selected", membershipIds: ids } : null;
  }
  if (typeof request?.filtersQuery !== "string") return null;
  return { kind: "filter", filters: parseDirectoryFilters(new URLSearchParams(request.filtersQuery.slice(0, 500))) };
}

export type ReminderPreviewResult = { error?: string; preview?: ReminderPreview };

/** How many a send would reach, and how many it would skip, before anything is sent. */
export async function previewRemindersAction(request: ReminderRequest): Promise<ReminderPreviewResult> {
  const context = await requireAdminWriteContext(typeof request?.school === "string" ? request.school : null);
  if ("error" in context) return context;
  const target = reminderTarget(request);
  if (!target) return { error: "Choose some students first." };
  try {
    return { preview: await previewReminderAudience(context.schoolId, target) };
  } catch (err) {
    if (err instanceof AdminError) return { error: err.message };
    throw err;
  }
}

export type ReminderSendResult = {
  error?: string;
  sent?: number;
  recentlyReminded?: number;
  noAccess?: number;
  /** A shared demo login: nothing was sent, and this many would have been. */
  demoWouldSend?: number;
};

export async function sendRemindersAction(request: ReminderRequest & { subject: unknown; message: unknown }): Promise<ReminderSendResult> {
  const context = await requireAdminWriteContext(typeof request?.school === "string" ? request.school : null);
  if ("error" in context) return context;
  const target = reminderTarget(request);
  if (!target) return { error: "Choose some students first." };

  try {
    // A shared demo login shows what would happen and sends nothing: a send
    // would mark the demo's students "Reminded" for every later visitor.
    if (await isDemoSession()) {
      const cleaned = cleanReminderInput(request);
      if ("error" in cleaned) return cleaned;
      const preview = await previewReminderAudience(context.schoolId, target);
      return { demoWouldSend: preview.eligible };
    }
    const sender = await prisma.user.findUniqueOrThrow({ where: { id: context.userId }, select: { firstName: true } });
    const result = await sendStudentReminders(context.schoolId, sender, target, request);
    revalidatePath("/admin/students");
    revalidatePath("/admin");
    return result;
  } catch (err) {
    if (err instanceof AdminError) return { error: err.message };
    throw err;
  }
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
  const context = await requireAdminWriteContext(schoolField(formData));
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
