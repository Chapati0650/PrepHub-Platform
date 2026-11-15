"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { logUnauthorizedAccess } from "@/lib/logger";
import {
  ClassRushError,
  classRushMe,
  joinClassRush,
  serveClassRushQuestion,
  submitClassRushAnswer,
  type ClassRushAnswerResult,
  type ClassRushMe,
  type ClassRushQuestion,
} from "@/lib/rush/class-rush";

// A student's side of a Class Rush. Expected problems come back as data, not
// thrown: production replaces a thrown action's message with a generic one,
// and the screen needs to tell "that question is over" from a dropped request.

export type ClassRushProblem = { problem: ClassRushError["code"]; message: string };

async function requireStudentId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!canUseStudentExperience(session.user.role)) {
    logUnauthorizedAccess("Non-student role attempted a Class Rush action", { accountId: session.user.id, role: session.user.role });
    throw new Error("Not authorized.");
  }
  return session.user.id;
}

async function asProblem<T>(work: () => Promise<T>): Promise<T | ClassRushProblem> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof ClassRushError) return { problem: err.code, message: err.message };
    throw err;
  }
}

/** The Join button: a press, never a page view, so a link previewed in a chat app never puts anyone in a game. */
export async function joinClassRushAction(formData: FormData): Promise<void> {
  const studentId = await requireStudentId();
  const rushId = String(formData.get("rushId") ?? "");
  try {
    await joinClassRush(studentId, rushId);
  } catch (err) {
    if (!(err instanceof ClassRushError)) throw err;
    // The game page says what went wrong (ended, another class).
  }
  redirect(`/rush/class/${rushId}`);
}

export async function classRushMeAction(rushId: string): Promise<ClassRushMe | ClassRushProblem> {
  const studentId = await requireStudentId();
  return asProblem(() => classRushMe(studentId, String(rushId)));
}

export async function classRushQuestionAction(rushId: string): Promise<ClassRushQuestion | ClassRushProblem> {
  const studentId = await requireStudentId();
  return asProblem(() => serveClassRushQuestion(studentId, String(rushId)));
}

export async function submitClassRushAnswerAction(
  rushId: string,
  position: number,
  answer: string | null,
): Promise<ClassRushAnswerResult | ClassRushProblem> {
  const studentId = await requireStudentId();
  if (!Number.isInteger(position) || (answer !== null && typeof answer !== "string")) return { problem: "INVALID", message: "That answer couldn't be read." };
  return asProblem(() => submitClassRushAnswer({ studentId, rushId: String(rushId), position, answer: answer === null ? null : answer.slice(0, 200) }));
}
