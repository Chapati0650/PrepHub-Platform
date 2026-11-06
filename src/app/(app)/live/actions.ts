"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { logUnauthorizedAccess } from "@/lib/logger";
import type { GuidedConfidence, GuidedPace } from "@/generated/prisma/client";
import { GuidedError } from "@/lib/guided/errors";
import { lookupSessionCode } from "@/lib/guided/queries";
import {
  getPersonalState,
  getStudentRecap,
  joinGuidedSession,
  requestGuidedBonus,
  saveGuidedDraft,
  setGuidedConfidence,
  setGuidedPace,
  submitCatchUpAnswer,
  submitGuidedAnswer,
  submitOwnAnswer,
  submitOwnRetry,
  type Feedback,
  type PersonalState,
  type StudentRecap,
} from "@/lib/guided/student";

/**
 * Guided Sessions are for student accounts in a class (the same rule as
 * homework). Every action returns its problem as data rather than throwing:
 * a production build replaces a thrown message with a generic one, and a
 * student in the middle of a class needs to be told what happened.
 */
async function requireStudentId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "STUDENT") {
    logUnauthorizedAccess("Non-student attempted a Guided Session action", { accountId: session.user.id, role: session.user.role });
    throw new Error("Not authorized.");
  }
  return session.user.id;
}

export type GuidedResult<T> = ({ ok: true } & T) | { ok: false; error: string };

async function attempt<T>(run: () => Promise<T>): Promise<GuidedResult<T>> {
  try {
    return { ok: true, ...(await run()) };
  } catch (err) {
    if (err instanceof GuidedError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function joinSessionAction(sessionId: string): Promise<GuidedResult<{ mine: PersonalState }>> {
  const studentId = await requireStudentId();
  return attempt(async () => {
    await joinGuidedSession(studentId, sessionId);
    return { mine: await getPersonalState(studentId, sessionId) };
  });
}

export async function myStateAction(sessionId: string): Promise<GuidedResult<{ mine: PersonalState }>> {
  const studentId = await requireStudentId();
  return attempt(async () => ({ mine: await getPersonalState(studentId, sessionId) }));
}

export async function recapAction(sessionId: string): Promise<GuidedResult<{ recap: StudentRecap }>> {
  const studentId = await requireStudentId();
  return attempt(async () => ({ recap: await getStudentRecap(studentId, sessionId) }));
}

export async function saveDraftAction(sessionId: string, itemId: string, draft: string | null): Promise<GuidedResult<object>> {
  const studentId = await requireStudentId();
  return attempt(async () => {
    await saveGuidedDraft(studentId, sessionId, itemId, draft);
    return {};
  });
}

export async function submitAnswerAction(sessionId: string, itemId: string, answer: string): Promise<GuidedResult<{ vote: 1 | 2 }>> {
  const studentId = await requireStudentId();
  return attempt(() => submitGuidedAnswer(studentId, sessionId, itemId, answer));
}

const CONFIDENCE: GuidedConfidence[] = ["SURE", "THINK_SO", "GUESSING"];
const PACE: GuidedPace[] = ["TOO_FAST", "ABOUT_RIGHT", "TOO_SLOW"];

export async function confidenceAction(sessionId: string, itemId: string, confidence: string): Promise<GuidedResult<object>> {
  const studentId = await requireStudentId();
  if (!CONFIDENCE.includes(confidence as GuidedConfidence)) return { ok: false, error: "Choose one." };
  return attempt(async () => {
    await setGuidedConfidence(studentId, sessionId, itemId, confidence as GuidedConfidence);
    return {};
  });
}

export async function paceAction(sessionId: string, pace: string): Promise<GuidedResult<object>> {
  const studentId = await requireStudentId();
  if (!PACE.includes(pace as GuidedPace)) return { ok: false, error: "Choose one." };
  return attempt(async () => {
    await setGuidedPace(studentId, sessionId, pace as GuidedPace);
    return {};
  });
}

export async function ownAnswerAction(slotId: string, answer: string): Promise<GuidedResult<{ feedback: Feedback }>> {
  const studentId = await requireStudentId();
  return attempt(async () => ({ feedback: await submitOwnAnswer(studentId, slotId, answer) }));
}

export async function bonusAction(sessionId: string): Promise<GuidedResult<{ mine: PersonalState; created: boolean }>> {
  const studentId = await requireStudentId();
  return attempt(async () => {
    const created = await requestGuidedBonus(studentId, sessionId);
    return { created, mine: await getPersonalState(studentId, sessionId) };
  });
}

export async function retryAction(slotId: string, answer: string): Promise<GuidedResult<{ feedback: Feedback }>> {
  const studentId = await requireStudentId();
  return attempt(async () => ({ feedback: await submitOwnRetry(studentId, slotId, answer) }));
}

export async function catchUpAction(itemId: string, answer: string): Promise<GuidedResult<{ feedback: Feedback }>> {
  const studentId = await requireStudentId();
  return attempt(async () => ({ feedback: await submitCatchUpAnswer(studentId, itemId, answer) }));
}

export type CodeState = { error?: string; classCode?: string; className?: string };

/** "Have a code?" on /live. A code for another class points the student to joining it first. */
export async function joinByCodeAction(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const studentId = await requireStudentId();
  const result = await lookupSessionCode(studentId, String(formData.get("code") ?? ""));
  switch (result.kind) {
    case "SESSION":
      redirect(`/live/${result.sessionId}`);
    case "NOT_IN_CLASS":
      return { classCode: result.classJoinCode, className: result.className };
    case "ENDED":
      return { error: "That session has ended. If it was your class's, its catch-up is on your home page." };
    default:
      return { error: "That code doesn't match a session that's running. Check the board and try again." };
  }
}
