"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ExtraTime, QuestionCategory } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOwnedClassroom, requireTeacherAction } from "@/lib/teacher/access";
import { TeacherError } from "@/lib/teacher/errors";
import { CATEGORY_ORDER } from "@/lib/content/constants";
import { SESSION_LENGTHS, type SessionLength } from "@/lib/guided/config";
import { createGuidedSession } from "@/lib/guided/create";
import { runCommand, type GuidedCommand } from "@/lib/guided/control";
import { GuidedError } from "@/lib/guided/errors";

export type StartState = { error?: string };

export async function startSessionAction(classroomId: string, _prev: StartState, formData: FormData): Promise<StartState> {
  const context = await requireTeacherAction();
  const category = String(formData.get("category") ?? "") as QuestionCategory;
  const length = String(formData.get("length") ?? "STANDARD") as SessionLength;
  if (!CATEGORY_ORDER.includes(category)) return { error: "Choose a skill." };
  if (!(length in SESSION_LENGTHS)) return { error: "Choose a length." };
  let id: string;
  try {
    ({ id } = await createGuidedSession(context, classroomId, { category, length }));
  } catch (err) {
    if (err instanceof GuidedError || err instanceof TeacherError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/teacher/classes/${classroomId}`);
  redirect(`/teacher/live/${id}`);
}

const COMMANDS = new Set([
  "NEXT",
  "TALK",
  "REVOTE",
  "REVEAL",
  "EXPLAIN",
  "TWIN",
  "STEP",
  "ADD_TIME",
  "PAUSE",
  "SKIP",
  "OWN",
  "RECAP",
  "END",
  "ENTER_ANSWER",
]);

/**
 * Every console button. The command is checked here rather than trusted: a
 * Server Action's argument is whatever the browser sends.
 */
export async function commandAction(sessionId: string, raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const context = await requireTeacherAction();
  if (!raw || typeof raw !== "object" || !COMMANDS.has(String((raw as { type?: unknown }).type))) {
    return { ok: false, error: "Unknown action." };
  }
  const input = raw as Record<string, unknown>;
  let command: GuidedCommand;
  switch (input.type) {
    case "STEP":
      command = { type: "STEP", delta: Number(input.delta) < 0 ? -1 : 1 };
      break;
    case "PAUSE":
      command = { type: "PAUSE", paused: input.paused === true };
      break;
    case "ENTER_ANSWER":
      command = { type: "ENTER_ANSWER", studentId: String(input.studentId ?? ""), answer: String(input.answer ?? "") };
      break;
    default:
      command = { type: input.type } as GuidedCommand;
  }
  try {
    await runCommand(context, sessionId, command);
    if (command.type === "END") revalidatePath("/teacher", "layout");
    return { ok: true };
  } catch (err) {
    if (err instanceof GuidedError) return { ok: false, error: err.message };
    throw err;
  }
}

const EXTRA_TIMES: ExtraTime[] = ["NONE", "TIME_AND_HALF", "DOUBLE"];

/** A student's extended-time accommodation, set once by the teacher. */
export async function setExtraTimeAction(classroomId: string, studentId: string, value: string): Promise<{ ok: boolean }> {
  const context = await requireTeacherAction();
  if (!EXTRA_TIMES.includes(value as ExtraTime)) return { ok: false };
  await requireOwnedClassroom(context, classroomId);
  await prisma.$transaction([
    prisma.classroomEnrollment.updateMany({
      where: { classroomId, studentId, removedAt: null },
      data: { extraTime: value as ExtraTime },
    }),
    // A session already running picks it up too.
    prisma.guidedParticipant.updateMany({
      where: { studentId, session: { classroomId, status: "OPEN" } },
      data: { extraTime: value as ExtraTime },
    }),
  ]);
  revalidatePath(`/teacher/classes/${classroomId}`);
  return { ok: true };
}
