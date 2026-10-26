"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { logUnauthorizedAccess } from "@/lib/logger";
import { answerDailyChallenge, type DailyAnswerResult } from "@/lib/daily/challenge";

// Free for every signed-in student by design — no paid-access check.
// A question that closed at midnight comes back as a result, not a throw,
// so the page can say so (see `DailyAnswerResult`).
export async function answerDailyChallengeAction(challengeId: string, answer: string): Promise<DailyAnswerResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authorized.");
  if (!canUseStudentExperience(session.user.role)) {
    logUnauthorizedAccess("Non-student role attempted the Daily Challenge", { accountId: session.user.id, role: session.user.role });
    throw new Error("Not authorized.");
  }
  if (!answer.trim()) throw new Error("Choose an answer.");
  const result = await answerDailyChallenge(session.user.id, challengeId, answer.trim());
  revalidatePath("/daily");
  revalidatePath("/home");
  return result;
}
