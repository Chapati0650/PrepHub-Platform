"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSchoolContext } from "@/lib/admin/school-context";
import { publishAnnouncement, removeAnnouncement } from "@/lib/announcements";
import { AdminError } from "@/lib/admin/errors";
import { createAnnouncementSchema } from "@/lib/validation/admin";

export type ActionState = { error?: string; success?: boolean };

function formEntries(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

export async function publishAnnouncementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { schoolId, userId } = await requireAdminSchoolContext();
  if (!schoolId) return { error: "Not authorized." };

  const raw = formEntries(formData);
  const parsed = createAnnouncementSchema.safeParse({
    ...raw,
    expiresAt: raw.expiresAt || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await publishAnnouncement(schoolId, userId, parsed.data);

  revalidatePath("/admin/announcements");
  revalidatePath("/home");
  return { success: true };
}

export async function removeAnnouncementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { schoolId } = await requireAdminSchoolContext();
  if (!schoolId) return { error: "Not authorized." };

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
