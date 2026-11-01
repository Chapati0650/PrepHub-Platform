import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { processBulkUploadImage, processBulkUploadPdfPage } from "@/lib/content/bulk-upload";
import { logServerError } from "@/lib/logger";
import { requireOwnerRequest } from "../../../owner-request";

// One bulk-upload file per request: a photo/screenshot (kind=image) or one
// rendered PDF page (kind=pdfPage), run through the whole pipeline in
// bulk-upload.ts — transcribe, classify, find the answer, explain — and landed
// as Drafts. Called by bulk-upload-form.tsx in a pool of three.
//
// It was two Server Actions until 2026-11-01, and the pool of three never ran
// more than one: Next dispatches Server Actions one at a time per client (see
// ../../../owner-request.ts). A batch of twenty images took twenty times one
// image. As a Route Handler the three requests really are in flight together.
//
// Same results as the actions returned, as JSON: `{ questionId, skipped }` or
// `{ error }` for an image; `{ questionIds, errors, skipped }` for a page.

export async function POST(request: Request) {
  const denied = await requireOwnerRequest();
  if (denied) return denied;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "That upload didn't arrive whole. Try it again." }, { status: 400 });
  }
  const file = formData.get("file");
  const kind = formData.get("kind") === "pdfPage" ? "pdfPage" : "image";
  if (!(file instanceof File)) {
    return NextResponse.json(kind === "pdfPage" ? { questionIds: [], errors: ["No file provided."] } : { error: "No file provided." });
  }
  const input = { buffer: Buffer.from(await file.arrayBuffer()), mimeType: file.type };

  try {
    if (kind === "pdfPage") {
      const result = await processBulkUploadPdfPage(input);
      if (result.questionIds.length > 0) revalidatePath("/owner/content/questions");
      return NextResponse.json(result);
    }
    const result = await processBulkUploadImage(input);
    if ("error" in result) return NextResponse.json({ error: result.error });
    revalidatePath("/owner/content/questions");
    return NextResponse.json({ questionId: result.questionId, skipped: result.skipped });
  } catch (err) {
    // Anything bulk-upload.ts didn't turn into a reason of its own. Never the
    // raw error: it can carry a provider's response body.
    logServerError("Bulk upload request failed", { kind, errorType: err instanceof Error ? err.name : "Unknown" });
    const message = "Something went wrong processing this file. Check the Questions table before retrying, in case it finished anyway.";
    return NextResponse.json(kind === "pdfPage" ? { questionIds: [], errors: [message] } : { error: message }, { status: 500 });
  }
}
