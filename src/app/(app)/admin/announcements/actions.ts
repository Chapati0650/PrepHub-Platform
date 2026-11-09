"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSchoolContext, requireAdminWriteContext, schoolField } from "@/lib/admin/school-context";
import { publishAnnouncement, removeAnnouncement } from "@/lib/announcements";
import { AdminError } from "@/lib/admin/errors";
import { createAnnouncementSchema } from "@/lib/validation/admin";
import { logServerError } from "@/lib/logger";
import { SCHOOLS_CONTACT_EMAIL } from "@/components/marketing/site-chrome";
import { DEMO_LOCKED_MESSAGE, isDemoSession } from "@/lib/demo-guard";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { localDateInputValue } from "@/lib/community/local-day";

export type ActionState = { error?: string; success?: boolean };

function formEntries(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * On a shared demo login, an announcement sent with no end date ends tonight, so a visitor's test
 * doesn't greet everyone who tries the demo after them.
 */
async function endTonightOnDemo(formData: FormData): Promise<void> {
  const given = formData.get("expiresAt");
  if ((typeof given === "string" && given.trim()) || !(await isDemoSession())) return;
  formData.set("expiresAt", localDateInputValue(new Date()));
}

/** The `school` field value that sends one announcement to every campus of the district (2026-11-09). */
const WHOLE_DISTRICT = "district";

export async function publishAnnouncementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await endTonightOnDemo(formData);
  if (schoolField(formData) === WHOLE_DISTRICT) return publishToDistrict(formData);
  const context = await requireAdminWriteContext(schoolField(formData));
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

/**
 * A district administrator's announcement to every campus at once: the same announcement written to
 * each campus (where its students already look, and its own admins can take it down), each campus's
 * students emailed once. The campuses come from the administrator's own district assignment, never from
 * the form.
 */
async function publishToDistrict(formData: FormData): Promise<ActionState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Please sign in again." };
  const { district, viewingAsOwner } = await requireAdminSchoolContext(undefined);
  if (!district || viewingAsOwner) return { error: "Only a district administrator can send to every campus." };
  const raw = formEntries(formData);
  const parsed = createAnnouncementSchema.safeParse({ ...raw, expiresAt: raw.expiresAt || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  let sent = 0;
  for (const campus of district.campuses) {
    try {
      await publishAnnouncement(campus.id, session.user.id, parsed.data);
      sent++;
    } catch (err) {
      logServerError("District announcement publish failed", {
        organizationId: campus.id,
        errorType: err instanceof Error ? err.name : "Unknown",
      });
      return {
        error: `It went to ${sent} of ${district.campuses.length} campuses before something failed on our side. Check each campus's Announcements page before sending again. If it keeps happening, email ${SCHOOLS_CONTACT_EMAIL}.`,
      };
    }
  }
  revalidatePath("/admin/announcements");
  revalidatePath("/home");
  return { success: true };
}

export async function removeAnnouncementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (await isDemoSession()) {
    // A visitor can take down what they just sent (review, 2026-11-09: test sends were stuck on every
    // demo student's home page), but not the demo's own announcements.
    const id = formData.get("announcementId");
    const a = typeof id === "string" ? await prisma.announcement.findUnique({ where: { id }, select: { publishedAt: true } }) : null;
    if (!a?.publishedAt || a.publishedAt.getTime() < Date.now() - DAY_MS) return { error: DEMO_LOCKED_MESSAGE };
  }
  const context = await requireAdminWriteContext(schoolField(formData));
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
