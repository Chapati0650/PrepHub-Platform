"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { logUnauthorizedAccess } from "@/lib/logger";
import { searchColleges } from "@/lib/colleges/directory";
import { CollegeAppsError } from "@/lib/college-apps/tracker";
import {
  copySupplementsFromPreviousCycle,
  createSupplement,
  deleteSupplement,
  moveSupplement,
  updateSupplement,
} from "@/lib/college-apps/supplements";
import { parsePrompts, type ParsedPrompt } from "@/lib/college-apps/parse-prompts";

export type SupplementActionState = { error?: string; saved?: boolean };

async function requireOwner() {
  const session = await auth();
  if (session?.user.role !== "OWNER") {
    logUnauthorizedAccess("Non-Owner attempted an Owner-only supplements action", { accountId: session?.user.id, role: session?.user.role });
    redirect("/home");
  }
}

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}
function toState(err: unknown): SupplementActionState {
  if (err instanceof CollegeAppsError) return { error: err.message };
  throw err;
}
function refresh(collegeId: number, cycle: number) {
  revalidatePath("/owner/content/supplements");
  revalidatePath(`/owner/content/supplements/${collegeId}?cycle=${cycle}`);
}

export async function searchCollegesForOwnerAction(query: string) {
  await requireOwner();
  return searchColleges(query, 10).map((c) => ({ id: c.id, name: c.name, city: c.city, state: c.state }));
}

export async function createSupplementAction(_prev: SupplementActionState, formData: FormData): Promise<SupplementActionState> {
  await requireOwner();
  const collegeId = Number(str(formData, "collegeId"));
  const cycle = Number(str(formData, "cycle"));
  const limitRaw = str(formData, "wordLimit").trim();
  try {
    await createSupplement(collegeId, cycle, {
      title: str(formData, "title"),
      promptText: str(formData, "promptText"),
      wordLimit: limitRaw ? Math.max(1, Math.round(Number(limitRaw))) || null : null,
    });
  } catch (err) {
    return toState(err);
  }
  refresh(collegeId, cycle);
  return { saved: true };
}

export async function updateSupplementAction(_prev: SupplementActionState, formData: FormData): Promise<SupplementActionState> {
  await requireOwner();
  const limitRaw = str(formData, "wordLimit").trim();
  try {
    await updateSupplement(str(formData, "id"), {
      title: str(formData, "title"),
      promptText: str(formData, "promptText"),
      wordLimit: limitRaw ? Math.max(1, Math.round(Number(limitRaw))) || null : null,
    });
  } catch (err) {
    return toState(err);
  }
  refresh(Number(str(formData, "collegeId")), Number(str(formData, "cycle")));
  return { saved: true };
}

export async function moveSupplementAction(formData: FormData): Promise<void> {
  await requireOwner();
  const direction = str(formData, "direction");
  if (direction !== "up" && direction !== "down") return;
  await moveSupplement(str(formData, "id"), direction);
  refresh(Number(str(formData, "collegeId")), Number(str(formData, "cycle")));
}

export async function deleteSupplementAction(formData: FormData): Promise<void> {
  await requireOwner();
  await deleteSupplement(str(formData, "id"));
  refresh(Number(str(formData, "collegeId")), Number(str(formData, "cycle")));
}

export async function copyFromPreviousCycleAction(formData: FormData): Promise<void> {
  await requireOwner();
  const collegeId = Number(str(formData, "collegeId"));
  const cycle = Number(str(formData, "cycle"));
  await copySupplementsFromPreviousCycle(collegeId, cycle);
  refresh(collegeId, cycle);
}

// The Owner's August accelerator: paste a college's Writing section from
// Common App, get the prompts back for review, then save them in one go.
// Two steps on purpose — the model's output is never written unseen.
export async function parseSupplementsAction(text: string): Promise<{ prompts?: ParsedPrompt[]; error?: string }> {
  await requireOwner();
  try {
    return { prompts: await parsePrompts(text) };
  } catch (err) {
    if (err instanceof CollegeAppsError) return { error: err.message };
    throw err;
  }
}

export async function saveParsedSupplementsAction(collegeId: number, cycle: number, prompts: ParsedPrompt[]): Promise<SupplementActionState> {
  await requireOwner();
  try {
    for (const p of prompts.slice(0, 20)) {
      await createSupplement(collegeId, cycle, { title: p.title, promptText: p.text, wordLimit: p.wordLimit });
    }
  } catch (err) {
    return toState(err);
  }
  refresh(collegeId, cycle);
  return { saved: true };
}
