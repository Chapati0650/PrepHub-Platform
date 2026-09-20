"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { hasPaidAccess } from "@/lib/entitlements";
import { logUnauthorizedAccess } from "@/lib/logger";
import { getStudentQuestionContent, getStudentQuestionFeedback } from "@/lib/session/question-content";
import { isRushDifficulty, isRushMode, isRushSection } from "@/lib/rush/config";
import { normalizeRushCode } from "@/lib/rush/codes";
import { RushError } from "@/lib/rush/errors";
import {
  getReviewableSlot,
  joinChallenge,
  serveCurrentQuestion,
  startRandomRush,
  startRush,
  submitRushAnswer,
  type RushAnswerResult,
  type ServedQuestion,
} from "@/lib/rush/runs";

async function requireStudentId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authorized.");
  if (!canUseStudentExperience(session.user.role)) {
    logUnauthorizedAccess("Non-student role attempted a 1v1 Rush action", { accountId: session.user.id, role: session.user.role });
    throw new Error("Not authorized.");
  }
  return session.user.id;
}

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

// "Start rush" on the hub. Starting any rush — solo, random, or a friend
// challenge — is Premium; the check is here as well as on the page because
// a hidden button is not access control. Accepting one is not (see
// joinRushAction below).
export async function startRushAction(formData: FormData): Promise<void> {
  const studentId = await requireStudentId();
  const section = str(formData, "section");
  const difficulty = str(formData, "difficulty");
  const mode = str(formData, "mode");
  if (!isRushSection(section) || !isRushDifficulty(difficulty) || !isRushMode(mode)) throw new Error("Choose a section, difficulty and mode.");
  if (!(await hasPaidAccess(studentId))) redirect("/pricing");

  let runId: string;
  try {
    if (mode === "RANDOM") {
      runId = (await startRandomRush(studentId, { section, difficulty })).runId;
    } else {
      runId = (await startRush(studentId, { section, difficulty, mode })).runId;
    }
  } catch (err) {
    if (err instanceof RushError && err.code === "NO_QUESTIONS") redirect(`/rush?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  redirect(`/rush/play/${runId}`);
}

// The free hook: any signed-in student can accept a friend's challenge by
// code (the hub's form) or by link (/rush/join/[code]'s Accept button — the
// same action, with the code in a hidden field). No paid-access check on
// purpose.
export async function joinRushAction(formData: FormData): Promise<void> {
  const studentId = await requireStudentId();
  const code = normalizeRushCode(str(formData, "code"));
  if (!code) redirect(`/rush?error=${encodeURIComponent("A code is six letters and numbers, like ABC234.")}`);

  let runId: string;
  try {
    runId = (await joinChallenge(studentId, code)).runId;
  } catch (err) {
    if (err instanceof RushError) redirect(`/rush?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  redirect(`/rush/play/${runId}`);
}

// ---- In-run actions, called from the RushRunner ----------------------------

export async function serveRushQuestionAction(runId: string): Promise<ServedQuestion | null> {
  const studentId = await requireStudentId();
  try {
    return await serveCurrentQuestion(studentId, runId);
  } catch (err) {
    if (err instanceof RushError) throw new Error(err.message);
    throw err;
  }
}

export async function submitRushAnswerAction(runId: string, position: number, answer: string | null): Promise<RushAnswerResult> {
  const studentId = await requireStudentId();
  try {
    return await submitRushAnswer({ studentId, runId, position, answer });
  } catch (err) {
    if (err instanceof RushError) throw new Error(err.message);
    throw err;
  }
}

// Results-page question review. getReviewableSlot only returns a revision
// for a challenge the student has *finished*, so a second player can't read
// the questions before their own run.
export async function loadRushQuestionDetailAction(challengeId: string, position: number) {
  const studentId = await requireStudentId();
  const slot = await getReviewableSlot(studentId, challengeId, position);
  if (!slot) throw new Error("Question not found.");
  const [content, feedback] = await Promise.all([getStudentQuestionContent(slot.questionRevisionId), getStudentQuestionFeedback(slot.questionRevisionId)]);
  return { content, feedback, studentAnswer: slot.answer };
}
