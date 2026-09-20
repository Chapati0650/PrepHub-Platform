"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { hasPaidAccess } from "@/lib/entitlements";
import { logUnauthorizedAccess } from "@/lib/logger";
import { getStudentQuestionContent, getStudentQuestionFeedback } from "@/lib/session/question-content";
import { RUSH_PLAY_OPTIONS, isRushPlayOption, isRushSection } from "@/lib/rush/config";
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
import {
  cancelLiveRoom,
  createLiveRoom,
  getLiveState,
  serveLiveQuestion,
  startLiveRandom,
  submitLiveAnswer,
  type LiveAnswerResult,
  type LiveServedQuestion,
  type LiveState,
} from "@/lib/rush/live";

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

function toHubError(err: unknown): never {
  if (err instanceof RushError) redirect(`/rush?error=${encodeURIComponent(err.message)}`);
  throw err;
}

// "Start rush" on the hub. Starting anything — solo, random, live or not,
// a friend challenge — is Premium; the check is here as well as on the
// page because a hidden button is not access control. Accepting one is
// not (see joinRushAction below).
export async function startRushAction(formData: FormData): Promise<void> {
  const studentId = await requireStudentId();
  const section = str(formData, "section");
  const option = str(formData, "option");
  if (!isRushSection(section) || !isRushPlayOption(option)) throw new Error("Choose a section and how to play.");
  if (!(await hasPaidAccess(studentId))) redirect("/pricing");

  const play = RUSH_PLAY_OPTIONS[option];
  let href: string;
  try {
    if (play.live) {
      const room = play.mode === "RANDOM" ? await startLiveRandom(studentId, section) : await createLiveRoom(studentId, { section, mode: "FRIEND" });
      href = `/rush/live/${room.challengeId}`;
    } else if (play.mode === "RANDOM") {
      href = `/rush/play/${(await startRandomRush(studentId, { section })).runId}`;
    } else {
      href = `/rush/play/${(await startRush(studentId, { section, mode: play.mode })).runId}`;
    }
  } catch (err) {
    toHubError(err);
  }
  redirect(href);
}

// The free hook: any signed-in student can accept a friend's challenge by
// code (the hub's form) or by link (/rush/join/[code]'s Accept button — the
// same action, with the code in a hidden field). No paid-access check on
// purpose. A live room routes to the room; a recorded one to the runner.
export async function joinRushAction(formData: FormData): Promise<void> {
  const studentId = await requireStudentId();
  const code = normalizeRushCode(str(formData, "code"));
  if (!code) redirect(`/rush?error=${encodeURIComponent("A code is six letters and numbers, like ABC234.")}`);

  let href: string;
  try {
    const joined = await joinChallenge(studentId, code);
    href = joined.live ? `/rush/live/${joined.challengeId}` : `/rush/play/${joined.runId}`;
  } catch (err) {
    toHubError(err);
  }
  redirect(href);
}

// ---- Recorded (async) runs, called from the RushRunner --------------------

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

// ---- Live rooms, called from LiveRush ---------------------------------------

export async function pollLiveAction(challengeId: string): Promise<LiveState | null> {
  const studentId = await requireStudentId();
  return getLiveState(studentId, challengeId);
}

export async function serveLiveQuestionAction(challengeId: string): Promise<LiveServedQuestion | { notYet: true }> {
  const studentId = await requireStudentId();
  try {
    return await serveLiveQuestion(studentId, challengeId);
  } catch (err) {
    if (err instanceof RushError && err.code === "NOT_SERVED") return { notYet: true };
    if (err instanceof RushError) throw new Error(err.message);
    throw err;
  }
}

export async function submitLiveAnswerAction(challengeId: string, position: number, answer: string | null): Promise<LiveAnswerResult | { over: true }> {
  const studentId = await requireStudentId();
  try {
    return await submitLiveAnswer({ studentId, challengeId, position, answer });
  } catch (err) {
    if (err instanceof RushError && (err.code === "RUN_COMPLETED" || err.code === "NOT_SERVED")) return { over: true };
    if (err instanceof RushError) throw new Error(err.message);
    throw err;
  }
}

// Leaving an empty lobby. Form action so it works as a plain button.
export async function leaveLiveRoomAction(formData: FormData): Promise<void> {
  const studentId = await requireStudentId();
  await cancelLiveRoom(studentId, str(formData, "challengeId"));
  redirect("/rush");
}

// Nobody showed up: close the empty lobby and race a recorded run instead.
export async function fallbackToRecordedAction(formData: FormData): Promise<void> {
  const studentId = await requireStudentId();
  const section = str(formData, "section");
  if (!isRushSection(section)) redirect("/rush");
  if (!(await hasPaidAccess(studentId))) redirect("/pricing");
  await cancelLiveRoom(studentId, str(formData, "challengeId"));
  let runId: string;
  try {
    runId = (await startRandomRush(studentId, { section })).runId;
  } catch (err) {
    toHubError(err);
  }
  redirect(`/rush/play/${runId}`);
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
