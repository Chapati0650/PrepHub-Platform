"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth, signOut } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { deleteAccountSchema } from "@/lib/validation/auth";
import { deleteAccount, logOutAllDevices } from "@/lib/auth/account";
import { AuthError } from "@/lib/auth/errors";
import type { ActionState } from "@/app/(auth)/actions";

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}

export async function logOutAllDevicesAction() {
  const session = await auth();
  if (!session?.user.id) redirect("/login");

  await logOutAllDevices(session.user.id);
  await signOut({ redirectTo: "/login" });
}

export async function deleteAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await auth();
  if (!session?.user.id) redirect("/login");

  const parsed = deleteAccountSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  try {
    await deleteAccount(session.user.id, parsed.data.password);
  } catch (err) {
    if (err instanceof AuthError) return { error: err.message };
    throw err;
  }

  await signOut({ redirectTo: "/" });
  return {};
}

// PRD-010 §"academic goal" / PRD-007 §9, PRD-008 §6: the target SAT score
// used by Target Score Progress, editable any time from Settings.
export async function updateTargetScoreAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canUseStudentExperience(session.user.role)) redirect("/login");

  const raw = formData.get("targetScore");
  if (raw === "" || raw === null) {
    await prisma.user.update({ where: { id: session.user.id }, data: { targetScore: null } });
    revalidatePath("/settings");
    revalidatePath("/home");
    revalidatePath("/progress");
    return { success: true };
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 400 || value > 1600) {
    return { error: "Enter a target score between 400 and 1600." };
  }

  await prisma.user.update({ where: { id: session.user.id }, data: { targetScore: value } });
  revalidatePath("/settings");
  revalidatePath("/home");
  revalidatePath("/progress");
  return { success: true };
}

// PRD-010 §5 — only the first name is editable; everything else on the
// Profile section (graduation year, verified school, email) is read-only.
export async function updateFirstNameAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await auth();
  if (!session?.user.id) redirect("/login");

  const firstName = formData.get("firstName");
  if (typeof firstName !== "string" || !firstName.trim()) {
    return { error: "First name is required." };
  }

  await prisma.user.update({ where: { id: session.user.id }, data: { firstName: firstName.trim() } });
  revalidatePath("/settings");
  revalidatePath("/home");
  return { success: true };
}

// PRD-010 §7 — only the Daily Practice Reminder is an independent toggle;
// the Streak Lost Email is always-on and has no corresponding field.
export async function updateNotificationPrefsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await auth();
  if (!session?.user.id) redirect("/login");

  await prisma.user.update({
    where: { id: session.user.id },
    data: { dailyReminderEnabled: formData.get("dailyReminderEnabled") === "on" },
  });
  revalidatePath("/settings");
  return { success: true };
}
