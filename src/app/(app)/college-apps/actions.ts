"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ApplicationItemKind, ApplicationPlan, ApplicationPlatform, ApplicationStatus } from "@/generated/prisma/client";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { hasPaidAccess } from "@/lib/entitlements";
import { logUnauthorizedAccess } from "@/lib/logger";
import { searchColleges } from "@/lib/colleges/directory";
import { isGrade } from "@/lib/college-apps/cycle";
import { isPlatform } from "@/lib/college-apps/platform-prompts";
import {
  CollegeAppsError,
  addCollege,
  addItems,
  completeOnboarding,
  deleteItem,
  removeCollege,
  setItemDone,
  updateApplication,
} from "@/lib/college-apps/tracker";

export type CollegeAppsActionState = { error?: string; saved?: boolean };

// College Apps is Premium (included in the single rate). Checked here, in
// every action, not only on the page: a hidden button is not access control.
async function requirePaidStudent(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authorized.");
  if (!canUseStudentExperience(session.user.role)) {
    logUnauthorizedAccess("Non-student role attempted a College Apps action", { accountId: session.user.id, role: session.user.role });
    throw new Error("Not authorized.");
  }
  if (!(await hasPaidAccess(session.user.id))) redirect("/pricing");
  return session.user.id;
}

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function toState(err: unknown): CollegeAppsActionState {
  if (err instanceof CollegeAppsError) return { error: err.message };
  throw err;
}

// ---- Onboarding ------------------------------------------------------------

export async function completeCollegeOnboardingAction(input: { grade: number; platforms: string[] }): Promise<void> {
  const studentId = await requirePaidStudent();
  if (!isGrade(input.grade)) throw new Error("Choose your grade.");
  const platforms = input.platforms.filter(isPlatform) as ApplicationPlatform[];
  await completeOnboarding(studentId, input.grade, platforms);
  revalidatePath("/college-apps");
  redirect("/college-apps");
}

// ---- Directory search (server-side: the JSON is 500 KB) -------------------

export async function searchCollegesAction(query: string) {
  await requirePaidStudent();
  return searchColleges(query, 12).map((c) => ({
    id: c.id,
    name: c.name,
    city: c.city,
    state: c.state,
    sat25: c.sat25,
    sat75: c.sat75,
    admissionRate: c.admissionRate,
  }));
}

// ---- Applications ----------------------------------------------------------

export async function addCollegeAction(formData: FormData): Promise<void> {
  const studentId = await requirePaidStudent();
  const collegeId = Number(str(formData, "collegeId"));
  if (!Number.isInteger(collegeId)) throw new Error("Choose a college.");
  let id: string;
  try {
    id = (await addCollege(studentId, collegeId)).id;
  } catch (err) {
    if (err instanceof CollegeAppsError) redirect(`/college-apps/add?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  revalidatePath("/college-apps");
  redirect(`/college-apps/${id}`);
}

export async function removeCollegeAction(formData: FormData): Promise<void> {
  const studentId = await requirePaidStudent();
  await removeCollege(studentId, str(formData, "applicationId"));
  revalidatePath("/college-apps");
  redirect("/college-apps");
}

const PLANS = new Set(["EARLY_DECISION", "EARLY_DECISION_2", "EARLY_ACTION", "RESTRICTIVE_EARLY_ACTION", "REGULAR_DECISION", "ROLLING"]);
const STATUSES = new Set(["RESEARCHING", "APPLYING", "SUBMITTED", "ACCEPTED", "WAITLISTED", "DENIED", "WITHDRAWN"]);

export async function updateApplicationAction(_prev: CollegeAppsActionState, formData: FormData): Promise<CollegeAppsActionState> {
  const studentId = await requirePaidStudent();
  const applicationId = str(formData, "applicationId");
  const platform = str(formData, "platform");
  const plan = str(formData, "plan");
  const status = str(formData, "status");
  const deadlineRaw = str(formData, "deadline");
  // <input type="date"> gives YYYY-MM-DD; store at UTC midnight so the day
  // is the same day everywhere and "days left" counts calendar days.
  const deadline = deadlineRaw ? new Date(`${deadlineRaw}T00:00:00Z`) : null;
  if (deadline && Number.isNaN(deadline.getTime())) return { error: "That deadline isn't a valid date." };
  try {
    await updateApplication(studentId, applicationId, {
      platform: isPlatform(platform) ? platform : null,
      plan: PLANS.has(plan) ? (plan as ApplicationPlan) : null,
      status: STATUSES.has(status) ? (status as ApplicationStatus) : "RESEARCHING",
      deadline,
      notes: str(formData, "notes").slice(0, 4000),
    });
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/college-apps");
  revalidatePath(`/college-apps/${applicationId}`);
  return { saved: true };
}

// ---- Checklist items -------------------------------------------------------

export async function toggleItemAction(formData: FormData): Promise<void> {
  const studentId = await requirePaidStudent();
  await setItemDone(studentId, str(formData, "itemId"), str(formData, "done") === "true");
  revalidatePath("/college-apps");
  const applicationId = str(formData, "applicationId");
  if (applicationId) revalidatePath(`/college-apps/${applicationId}`);
}

// PROMPT is deliberately absent: essay prompts are the Owner's curation, never student-entered.
const KINDS = new Set(["RECOMMENDATION", "TEST_SCORES", "FEE", "FINANCIAL_AID", "OTHER"]);

export async function addItemAction(_prev: CollegeAppsActionState, formData: FormData): Promise<CollegeAppsActionState> {
  const studentId = await requirePaidStudent();
  const applicationId = str(formData, "applicationId") || null;
  const kind = str(formData, "kind");
  const limitRaw = str(formData, "wordLimit").trim();
  try {
    await addItems(studentId, applicationId, [
      {
        kind: KINDS.has(kind) ? (kind as ApplicationItemKind) : "OTHER",
        title: str(formData, "title"),
        detail: str(formData, "detail"),
        wordLimit: limitRaw ? Math.max(1, Math.round(Number(limitRaw))) || null : null,
      },
    ]);
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/college-apps");
  if (applicationId) revalidatePath(`/college-apps/${applicationId}`);
  return { saved: true };
}

export async function deleteItemAction(formData: FormData): Promise<void> {
  const studentId = await requirePaidStudent();
  await deleteItem(studentId, str(formData, "itemId"));
  revalidatePath("/college-apps");
  const applicationId = str(formData, "applicationId");
  if (applicationId) revalidatePath(`/college-apps/${applicationId}`);
}
