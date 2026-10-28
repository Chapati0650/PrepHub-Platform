"use server";

import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { logUnauthorizedAccess } from "@/lib/logger";
import { recordWalkthroughFeedback } from "./walkthrough-feedback";

/**
 * A student's "Got it" / "Still confused" at the end of a walkthrough. Only
 * the student experience records it: an Owner previewing or a teacher reading
 * an answer key isn't the audience being asked. Never throws for a bad
 * revision id; the answer just isn't kept.
 */
export async function recordWalkthroughFeedbackAction(questionRevisionId: string, helpful: boolean, confusingStep: number | null): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authorized.");
  if (!canUseStudentExperience(session.user.role)) {
    logUnauthorizedAccess("Non-student role attempted to record walkthrough feedback", { accountId: session.user.id, role: session.user.role });
    throw new Error("Not authorized.");
  }
  if (typeof questionRevisionId !== "string" || typeof helpful !== "boolean") return;
  await recordWalkthroughFeedback(session.user.id, questionRevisionId, {
    helpful,
    confusingStep: typeof confusingStep === "number" ? confusingStep : null,
  });
}
