"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  createQuestion,
  updateDraftContent,
  markPreviewCompleted,
  publishQuestion,
  unpublishQuestion,
  archiveQuestion,
  restoreQuestion,
  deleteQuestionPermanently,
  duplicateQuestionContent,
  getQuestionOrThrow,
  type QuestionContentPatch,
} from "@/lib/content/questions";
import {
  createEmptyFamily,
  updateFamilyDetails,
  setFamilyVideo,
  addVersionToFamily,
  groupExistingQuestionsIntoFamily,
  publishFamily,
  unpublishFamily,
  archiveFamily,
  restoreFamily,
  duplicateQuestionIntoFamily,
} from "@/lib/content/families";
import { bulkArchive, bulkDeletePermanently, bulkPublish, bulkUnpublish, type BulkResult } from "@/lib/content/bulk";
import { uploadImage, uploadVideo } from "@/lib/content/media";
import { ContentError } from "@/lib/content/errors";
import { logUnauthorizedAccess } from "@/lib/logger";
import type { QuestionCategory, QuestionDifficulty, QuestionType } from "@/generated/prisma/client";

export type ActionResult = { error?: string; success?: boolean };

async function requireOwner() {
  const session = await auth();
  if (session?.user.role !== "OWNER") {
    logUnauthorizedAccess("Non-Owner attempted an Owner-only content action", {
      accountId: session?.user.id,
      role: session?.user.role,
    });
    redirect("/home");
  }
  return session;
}

function toMessage(err: unknown): string {
  if (err instanceof ContentError) return err.message;
  throw err;
}

export async function createQuestionAction(input: {
  questionType: QuestionType;
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
}) {
  await requireOwner();
  const question = await createQuestion(input);
  revalidatePath("/owner/content/questions");
  redirect(`/owner/content/questions/${question.id}`);
}

// Used by the editor to refetch full question+revision data after an action
// (publish/unpublish/preview flush) rather than trying to keep client state in
// sync with server props via an effect.
export async function getQuestionAction(questionId: string) {
  await requireOwner();
  return getQuestionOrThrow(questionId);
}

export async function updateQuestionContentAction(
  questionId: string,
  patch: QuestionContentPatch,
): Promise<ActionResult> {
  await requireOwner();
  try {
    await updateDraftContent(questionId, patch);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/owner/content/questions/${questionId}`);
  return { success: true };
}

export async function markPreviewCompletedAction(questionId: string): Promise<ActionResult> {
  await requireOwner();
  try {
    await markPreviewCompleted(questionId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/owner/content/questions/${questionId}`);
  return { success: true };
}

export async function publishQuestionAction(questionId: string): Promise<ActionResult> {
  await requireOwner();
  try {
    await publishQuestion(questionId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/owner/content/questions/${questionId}`);
  revalidatePath("/owner/content/questions");
  return { success: true };
}

export async function unpublishQuestionAction(questionId: string): Promise<ActionResult> {
  await requireOwner();
  try {
    await unpublishQuestion(questionId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/owner/content/questions/${questionId}`);
  revalidatePath("/owner/content/questions");
  return { success: true };
}

export async function archiveQuestionAction(questionId: string): Promise<ActionResult> {
  await requireOwner();
  try {
    await archiveQuestion(questionId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/owner/content/questions/${questionId}`);
  revalidatePath("/owner/content/questions");
  return { success: true };
}

export async function restoreQuestionAction(questionId: string): Promise<ActionResult> {
  await requireOwner();
  try {
    await restoreQuestion(questionId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/owner/content/questions/${questionId}`);
  revalidatePath("/owner/content/questions");
  return { success: true };
}

export async function deleteQuestionAction(questionId: string): Promise<ActionResult> {
  await requireOwner();
  try {
    await deleteQuestionPermanently(questionId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath("/owner/content/questions");
  return { success: true };
}

export async function duplicateQuestionAction(
  questionId: string,
  intoFamily: boolean,
): Promise<ActionResult & { newQuestionId?: string }> {
  await requireOwner();
  try {
    const duplicate = intoFamily
      ? await duplicateQuestionIntoFamily(questionId)
      : await duplicateQuestionContent(questionId);
    revalidatePath("/owner/content/questions");
    return { success: true, newQuestionId: duplicate.id };
  } catch (err) {
    return { error: toMessage(err) };
  }
}

// --- Question Families -----------------------------------------------------

export async function createEmptyFamilyAction(input: {
  category: QuestionCategory;
  difficulty: QuestionDifficulty;
  internalName?: string;
}) {
  await requireOwner();
  const family = await createEmptyFamily(input);
  revalidatePath("/owner/content/families");
  redirect(`/owner/content/families/${family.id}`);
}

export async function groupExistingQuestionsAction(input: {
  questionIds: string[];
  internalName?: string;
}) {
  await requireOwner();
  const family = await groupExistingQuestionsIntoFamily(input);
  revalidatePath("/owner/content/families");
  revalidatePath("/owner/content/questions");
  redirect(`/owner/content/families/${family.id}`);
}

export async function updateFamilyDetailsAction(
  familyId: string,
  input: { internalName?: string },
): Promise<ActionResult> {
  await requireOwner();
  try {
    await updateFamilyDetails(familyId, input);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/owner/content/families/${familyId}`);
  return { success: true };
}

export async function setFamilyVideoAction(familyId: string, mediaAssetId: string | null): Promise<ActionResult> {
  await requireOwner();
  try {
    await setFamilyVideo(familyId, mediaAssetId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/owner/content/families/${familyId}`);
  return { success: true };
}

export async function addVersionToFamilyAction(familyId: string, questionId: string): Promise<ActionResult> {
  await requireOwner();
  try {
    await addVersionToFamily(familyId, questionId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/owner/content/families/${familyId}`);
  revalidatePath("/owner/content/questions");
  return { success: true };
}

export async function createVersionInFamilyAction(
  familyId: string,
  input: { questionType: QuestionType; category: QuestionCategory; difficulty: QuestionDifficulty },
): Promise<ActionResult & { questionId?: string }> {
  await requireOwner();
  try {
    const question = await createQuestion(input);
    await addVersionToFamily(familyId, question.id);
    revalidatePath(`/owner/content/families/${familyId}`);
    return { success: true, questionId: question.id };
  } catch (err) {
    return { error: toMessage(err) };
  }
}

export async function publishFamilyAction(familyId: string): Promise<ActionResult> {
  await requireOwner();
  try {
    await publishFamily(familyId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/owner/content/families/${familyId}`);
  revalidatePath("/owner/content/questions");
  return { success: true };
}

export async function unpublishFamilyAction(familyId: string): Promise<ActionResult> {
  await requireOwner();
  try {
    await unpublishFamily(familyId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/owner/content/families/${familyId}`);
  revalidatePath("/owner/content/questions");
  return { success: true };
}

export async function archiveFamilyAction(familyId: string): Promise<ActionResult> {
  await requireOwner();
  try {
    await archiveFamily(familyId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/owner/content/families/${familyId}`);
  revalidatePath("/owner/content/questions");
  return { success: true };
}

export async function restoreFamilyAction(familyId: string): Promise<ActionResult> {
  await requireOwner();
  try {
    await restoreFamily(familyId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/owner/content/families/${familyId}`);
  revalidatePath("/owner/content/questions");
  return { success: true };
}

// --- Bulk actions ------------------------------------------------------------

export async function bulkPublishAction(questionIds: string[]): Promise<BulkResult> {
  await requireOwner();
  const result = await bulkPublish(questionIds);
  revalidatePath("/owner/content/questions");
  return result;
}

export async function bulkUnpublishAction(questionIds: string[]): Promise<BulkResult> {
  await requireOwner();
  const result = await bulkUnpublish(questionIds);
  revalidatePath("/owner/content/questions");
  return result;
}

export async function bulkArchiveAction(questionIds: string[]): Promise<BulkResult> {
  await requireOwner();
  const result = await bulkArchive(questionIds);
  revalidatePath("/owner/content/questions");
  return result;
}

export async function bulkDeleteAction(questionIds: string[]): Promise<BulkResult> {
  await requireOwner();
  const result = await bulkDeletePermanently(questionIds);
  revalidatePath("/owner/content/questions");
  return result;
}

// --- Media uploads -----------------------------------------------------------

export type MediaUploadResult = { error?: string; mediaId?: string; status?: string; failureReason?: string | null };

export async function uploadImageAction(formData: FormData): Promise<MediaUploadResult> {
  await requireOwner();
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file provided." };
  try {
    const asset = await uploadImage({
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
      originalFilename: file.name,
    });
    return { mediaId: asset.id, status: asset.status };
  } catch (err) {
    return { error: toMessage(err) };
  }
}

export async function uploadVideoAction(formData: FormData): Promise<MediaUploadResult> {
  await requireOwner();
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file provided." };
  try {
    const asset = await uploadVideo({
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
      originalFilename: file.name,
    });
    return { mediaId: asset.id, status: asset.status, failureReason: asset.failureReason };
  } catch (err) {
    return { error: toMessage(err) };
  }
}
