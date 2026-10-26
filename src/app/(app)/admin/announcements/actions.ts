"use server";

import { revalidatePath } from "next/cache";
import { requireAdminWriteContext } from "@/lib/admin/school-context";
import { publishAnnouncement, removeAnnouncement } from "@/lib/announcements";
import { AdminError } from "@/lib/admin/errors";
import { createAnnouncementSchema } from "@/lib/validation/admin";
import { logServerError } from "@/lib/logger";
import { SCHOOLS_CONTACT_EMAIL } from "@/components/marketing/site-chrome";

export type ActionState = { error?: string; success?: boolean };

function formEntries(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

export async function publishAnnouncementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireAdminWriteContext();
  if ("error" in context) return context;
  const { schoolId, userId } = context;

  const raw = formEntries(formData);
  const parsed = createAnnouncementSchema.safeParse({
    ...raw,
    expiresAt: raw.expiresAt || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  try {
    await publishAnnouncement(schoolId, userId, parsed.data);
  } catch (err) {
    if (err instanceof AdminError) return { error: err.message };
    // Anything else is ours, not the administrator's. In production a thrown
    // error reaches the page as a generic message, so say what to do instead.
    // Nothing was sent: the announcement and its emails are written together
    // or not at all (lib/announcements.ts).
    logServerError("Announcement publish failed", {
      organizationId: schoolId,
      errorType: err instanceof Error ? err.name : "Unknown",
    });
    return {
      error: `Your announcement couldn't be sent just now, and nothing went out to students. Please try again in a minute. If it keeps happening, email ${SCHOOLS_CONTACT_EMAIL}.`,
    };
  }

  revalidatePath("/admin/announcements");
  revalidatePath("/home");
  return { success: true };
}

export async function removeAnnouncementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const context = await requireAdminWriteContext();
  if ("error" in context) return context;
  const { schoolId } = context;

  const announcementId = formData.get("announcementId");
  if (typeof announcementId !== "string" || !announcementId) return { error: "Missing announcement id." };

  try {
    await removeAnnouncement(schoolId, announcementId);
  } catch (err) {
    if (err instanceof AdminError) return { error: err.message };
    throw err;
  }

  revalidatePath("/admin/announcements");
  revalidatePath("/home");
  return { success: true };
}
