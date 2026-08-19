"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  createQuestion,
  updateDraftContent,
  markPreviewCompleted,
  markAiReviewed,
  publishQuestion,
  unpublishQuestion,
  archiveQuestion,
  restoreQuestion,
  deleteQuestionPermanently,
  duplicateQuestionContent,
  getQuestionOrThrow,
  type QuestionContentPatch,
} from "@/lib/content/questions";
import { processBulkUploadImage, processBulkUploadPdfPage } from "@/lib/content/bulk-upload";
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
import {
  bulkArchive,
  bulkDeletePermanently,
  bulkEstimateDifficulty,
  bulkPublish,
  bulkSetDifficulty,
  bulkUnpublish,
  type BulkResult,
} from "@/lib/content/bulk";
import { uploadImage, uploadVideo } from "@/lib/content/media";
import { transcribeQuestionImage, type QuestionTranscription } from "@/lib/content/transcribe";
import {
  generateExplanationText,
  generateStepDiagram,
  generateDistractorExplanations,
  type ExplanationStepResult,
  type DistractorExplanationResult,
} from "@/lib/content/generate-explanation";
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

export async function bulkSetDifficultyAction(questionIds: string[], difficulty: QuestionDifficulty): Promise<BulkResult> {
  await requireOwner();
  const result = await bulkSetDifficulty(questionIds, difficulty);
  revalidatePath("/owner/content/questions");
  return result;
}

export async function bulkEstimateDifficultyAction(questionIds: string[]): Promise<BulkResult> {
  await requireOwner();
  const result = await bulkEstimateDifficulty(questionIds);
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

// --- Explanation generation ------------------------------------------------

type ExplanationGenerationInput = {
  questionText: string;
  category: string;
  questionType: "MULTIPLE_CHOICE" | "OPEN_ENDED_NUMERIC";
  answerChoices: string[] | null;
  correctChoiceIndex: number | null;
  acceptedAnswers: string[];
};

export type GenerateExplanationResult = { error?: string; steps?: ExplanationStepResult[] };

// Same review contract as transcription: this only produces a draft for the
// step-by-step explanation section below, saved through the normal queueSave
// path — nothing here publishes on its own. Text-only and deliberately cheap
// (no code execution) — see generateStepDiagramAction for the opt-in,
// per-step diagram generation, which costs meaningfully more.
export async function generateExplanationAction(input: ExplanationGenerationInput): Promise<GenerateExplanationResult> {
  await requireOwner();
  try {
    const steps = await generateExplanationText(input);
    return { steps };
  } catch (err) {
    return { error: toMessage(err) };
  }
}

export type GenerateDistractorExplanationsResult = { error?: string; distractors?: DistractorExplanationResult[] };

// MULTIPLE_CHOICE only — needs the correct-answer steps already generated
// (see generateDistractorExplanations's own comment for why: it's what lets
// the model identify *where* a wrong answer diverges, instead of guessing at
// student psychology from the bare question). Same review contract as the
// rest of this file's generation actions: fills the per-choice draft fields
// below for the Owner to review/edit, nothing publishes on its own.
export async function generateDistractorExplanationsAction(
  input: {
    questionText: string;
    category: string;
    answerChoices: string[];
    correctChoiceIndex: number;
    correctExplanationSteps: string[];
  },
): Promise<GenerateDistractorExplanationsResult> {
  await requireOwner();
  try {
    const distractors = await generateDistractorExplanations(input);
    return { distractors };
  } catch (err) {
    return { error: toMessage(err) };
  }
}

export type GenerateStepDiagramResult = { error?: string; imageId?: string | null };

export async function generateStepDiagramAction(
  input: ExplanationGenerationInput & { stepText: string },
): Promise<GenerateStepDiagramResult> {
  await requireOwner();
  try {
    const imageId = await generateStepDiagram(input, input.stepText);
    return { imageId };
  } catch (err) {
    return { error: toMessage(err) };
  }
}

// --- Question-image transcription ---------------------------------------

export type TranscribeResult = { error?: string; transcription?: QuestionTranscription };

// The uploaded photo/screenshot is never persisted — it exists only to
// produce a text draft the Owner reviews and edits before saving, same as
// hand-typing the question text. Nothing here bypasses the normal
// Draft -> preview -> Publish review gate.
export async function transcribeQuestionImageAction(formData: FormData): Promise<TranscribeResult> {
  await requireOwner();
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file provided." };
  try {
    const transcription = await transcribeQuestionImage({
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
    });
    return { transcription };
  } catch (err) {
    return { error: toMessage(err) };
  }
}

export type BulkUploadImageActionResult = { error?: string; questionId?: string; skipped?: boolean };

// Called once per image, in a small client-side concurrency pool (see
// bulk-upload-form.tsx) — not once per batch, since a single request running
// ~20 sequential AI calls would run well past any reasonable request
// timeout. Every question this creates lands DRAFT + aiGenerated: true;
// publish is available immediately (see validation.ts) but reviewing first
// is still recommended. `skipped: true` means this exact image was already
// processed (see processBulkUploadImage's sourceImageHash check) — no new
// AI call was made, questionId points at the existing question.
export async function bulkUploadImageAction(formData: FormData): Promise<BulkUploadImageActionResult> {
  await requireOwner();
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "No file provided." };

  const result = await processBulkUploadImage({
    buffer: Buffer.from(await file.arrayBuffer()),
    mimeType: file.type,
  });
  if ("error" in result) return { error: result.error };
  revalidatePath("/owner/content/questions");
  return { questionId: result.questionId, skipped: result.skipped };
}

export type BulkUploadPdfPageActionResult = { questionIds: string[]; errors: string[]; skipped?: boolean };

// Same concurrency-pool pattern as bulkUploadImageAction, one call per
// rendered PDF page (see extract-pdf-pages.ts, which does the PDF-to-images
// rendering client-side before this ever runs) — but a page can yield zero,
// one, or several questions, so the result is a batch rather than a single
// id (see processBulkUploadPdfPage).
export async function bulkUploadPdfPageAction(formData: FormData): Promise<BulkUploadPdfPageActionResult> {
  await requireOwner();
  const file = formData.get("file");
  if (!(file instanceof File)) return { questionIds: [], errors: ["No file provided."] };

  const result = await processBulkUploadPdfPage({
    buffer: Buffer.from(await file.arrayBuffer()),
    mimeType: file.type,
  });
  if (result.questionIds.length > 0) revalidatePath("/owner/content/questions");
  return result;
}

export async function markAiReviewedAction(questionId: string): Promise<ActionResult> {
  await requireOwner();
  try {
    await markAiReviewed(questionId);
  } catch (err) {
    return { error: toMessage(err) };
  }
  revalidatePath(`/owner/content/questions/${questionId}`);
  revalidatePath("/owner/content/questions");
  return { success: true };
}
