"use server";

import { prisma } from "@/lib/prisma";
import { verifyUnsubscribeToken } from "@/lib/lifecycle/unsubscribe";

export type UnsubscribeState = { error?: string; done?: boolean };

/**
 * The button on the unsubscribe page. Deliberately not authenticated: the
 * reminder is read in an inbox that may never have signed in to PrepHub, and
 * the signed token is the proof. Turning the toggle off twice is harmless.
 */
export async function unsubscribeAction(_prev: UnsubscribeState, formData: FormData): Promise<UnsubscribeState> {
  const token = formData.get("token");
  const userId = typeof token === "string" ? verifyUnsubscribeToken(token) : null;
  if (!userId) return { error: "This link doesn't work. You can turn reminders off in Settings, under Notifications." };

  await prisma.user.updateMany({ where: { id: userId }, data: { dailyReminderEnabled: false } });
  return { done: true };
}
