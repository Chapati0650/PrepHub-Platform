import sharp from "sharp";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { logTranscriptionFailure } from "@/lib/logger";
import { AI_MODELS, getAnthropicClient } from "@/lib/ai/client";
import { extractApiErrorMessage } from "@/lib/ai/api-error-message";
import { ContentError } from "./errors";
import { uploadImage } from "./media";

const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME_TO_MEDIA_TYPE: Record<string, "image/jpeg" | "image/png" | "image/webp"> = {
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
};

// Bounding box on a fixed 0-1000 scale on both axes, independent of the
// source image's actual pixel dimensions — a standard VLM grounding
// convention, and more robust than asking the model to reason in raw pixels
// against whatever internal resizing it does for its own analysis.
const BoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const TranscriptionSchema = z.object({
  questionText: z.string(),
  // null when the source image isn't a multiple-choice question (or no
  // choices are visible) — distinct from an empty array, which would imply
  // "found the question but zero choices," an unlikely and confusing result.
  answerChoices: z.array(z.string()).nullable(),
  // null when the question is text/math only, with nothing to crop out.
  visualElement: BoundingBoxSchema.nullable(),
});

export type QuestionTranscription = {
  questionText: string;
  answerChoices: string[] | null;
  // A MediaAsset id, already uploaded through the normal image pipeline —
  // ready to drop straight into the Question image field, exactly like a
  // manual MediaUploadField upload. Null if there was nothing to crop, or
  // if a visual was detected but the crop/upload step failed (best-effort:
  // see the fallback bracketed note in that case).
  questionImageId: string | null;
};

// PRD-013 §12's $...$ / $$...$$ convention (see latex-text.tsx) — the model
// must target this exact syntax, not generic LaTeX, or the transcribed text
// won't render in the app's preview at all.
const PROMPT = `Transcribe the SAT-style question shown in this image exactly as written, for entry into an SAT-prep platform's question editor.

Rules:
- Wrap every mathematical expression in $...$ for inline math or $$...$$ for a block/display equation. This is the ONLY math syntax this platform renders — plain text like "x^2" with no $ delimiters will show up as the literal characters "x^2", not an exponent, so do not omit the delimiters anywhere math appears.
- Wrap any span of text that is visibly underlined in the source image in [[...]] (e.g. "the [[fecal-steroidal profile]] of pronghorn"). This is the ONLY underline syntax this platform renders. Many Reading & Writing questions ask about "the underlined portion" — without this markup, the question becomes unanswerable, so look carefully for an underline anywhere in the passage/stem and mark it even if it spans multiple sentences or wraps across lines.
- Transcribe the question stem into questionText. If the image also shows multiple-choice answer options, transcribe each option's text (without the "A)"/"B)"/leading letter label) into answerChoices, in order. If there are no visible answer choices (e.g. it's a free-response/numeric question), set answerChoices to null.
- Do not solve the question, determine the correct answer, or add any commentary, headers, or explanation of your own — transcribe only what is written in the image.
- If the image contains a non-text visual element that is part of the question (a graph, chart, table, or diagram) — something that can't be represented as text — do not describe it in questionText at all; instead set visualElement to its bounding box, tightly cropped around the whole visual (including its axis labels, legend, or table headers/borders) with a small margin, but excluding the surrounding question text and answer choices. Use a coordinate system where the image's top-left corner is (0, 0) and its bottom-right corner is (1000, 1000) on both axes, regardless of the image's actual pixel dimensions. If there is no such visual element, set visualElement to null.`;

function getClient(): Anthropic {
  try {
    return getAnthropicClient();
  } catch {
    throw new ContentError("TRANSCRIPTION_FAILED", "Image transcription isn't configured for this environment.");
  }
}

// Crops the detected visual out of the original photo and runs it through
// the same upload pipeline a manual "Question image" upload would use. Never
// throws — a failed crop/upload shouldn't take down an otherwise-successful
// text transcription, matching the "optional side effects never block the
// core operation" pattern used elsewhere (see CLAUDE.md).
async function extractVisualElement(
  buffer: Buffer,
  box: z.infer<typeof BoundingBoxSchema>,
): Promise<string | null> {
  try {
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) return null;

    const clamp = (n: number) => Math.max(0, Math.min(1000, n));
    const left = Math.round((clamp(box.x) / 1000) * metadata.width);
    const top = Math.round((clamp(box.y) / 1000) * metadata.height);
    const width = Math.min(
      metadata.width - left,
      Math.round((Math.max(0, box.width) / 1000) * metadata.width),
    );
    const height = Math.min(
      metadata.height - top,
      Math.round((Math.max(0, box.height) / 1000) * metadata.height),
    );
    if (width < 10 || height < 10) return null;

    const cropped = await sharp(buffer).extract({ left, top, width, height }).png().toBuffer();
    const asset = await uploadImage({
      buffer: cropped,
      mimeType: "image/png",
      originalFilename: "transcribed-visual.png",
    });
    return asset.id;
  } catch (err) {
    logTranscriptionFailure("Failed to crop/upload the detected visual element from a transcribed question", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

const PageTranscriptionSchema = z.object({
  questions: z.array(TranscriptionSchema),
});

// PRD-013 §12 math syntax rules are identical to the single-question prompt
// above — this is that same job applied per-question across a page that may
// contain several (a PDF of a full practice test, rendered one page at a
// time — see extract-pdf-pages.ts on the client and processBulkUploadPdfPage
// in bulk-upload.ts). The one genuinely new instruction is what to do about
// a question that isn't fully contained on this page.
const PAGE_PROMPT = `This image is one page from a multi-page SAT practice test PDF. It may contain zero, one, or several complete SAT-style questions, for entry into an SAT-prep platform's question editor.

Rules:
- Identify every complete, self-contained question fully visible on this page. A question is "complete" only if its full stem, all its answer choices (if multiple-choice), and any supporting visual it needs are all present on this one page.
- If a question's stem or choices are cut off at the top or bottom of this page, or it depends on a shared passage/figure that isn't fully present on this page, do NOT include it — skip it entirely rather than guessing or transcribing a partial question. Omitting an incomplete question is correct; a partial or guessed one is not.
- Ignore anything on the page that is not itself a question: headers/footers, page numbers, section instructions, answer keys.
- For each complete question you do find, follow the exact same transcription rules as a single-question image: wrap every mathematical expression in $...$ (inline) or $$...$$ (block) — the ONLY math syntax this platform renders, so never omit the delimiters. Also wrap any span of text that is visibly underlined in the source image in [[...]] — the ONLY underline syntax this platform renders; many Reading & Writing questions ask about "the underlined portion" and are unanswerable without it, so look carefully for an underline anywhere in the passage/stem, even spanning multiple sentences. Transcribe the stem into questionText. If it's multiple-choice, transcribe each choice's text (without the "A)"/"B)" label) into answerChoices, in order; otherwise set answerChoices to null. Do not solve the question or add commentary. If a question includes a graph, chart, table, or diagram, set that question's visualElement to its tightly-cropped bounding box (0-1000 scale on both axes, image top-left is (0,0), excluding surrounding text); otherwise null.
- If this page has zero complete questions on it (a cover page, instructions, an answer key, or a page that's entirely a continuation of a question from the previous page), return an empty questions array — that is a normal, correct result, not an error.`;

// Same page image, potentially several questions worth of visuals to crop
// out of it — reuses extractVisualElement per question rather than
// duplicating that crop/upload logic.
export async function transcribeQuestionPage(input: { buffer: Buffer; mimeType: string }): Promise<QuestionTranscription[]> {
  const mediaType = IMAGE_MIME_TO_MEDIA_TYPE[input.mimeType];
  if (!mediaType) {
    throw new ContentError("UNSUPPORTED_FILE_TYPE", "Page images must be PNG, JPEG, or WebP.");
  }
  if (input.buffer.byteLength > IMAGE_MAX_BYTES) {
    throw new ContentError("FILE_TOO_LARGE", "Each page image must be 10 MB or smaller.");
  }

  const client = getClient();

  let response;
  try {
    response = await client.messages.parse({
      model: AI_MODELS.transcription,
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: input.buffer.toString("base64") },
            },
            { type: "text", text: PAGE_PROMPT },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(PageTranscriptionSchema) },
    });
  } catch (err) {
    logTranscriptionFailure("Anthropic API call failed during page transcription", {
      error: err instanceof Error ? err.message : String(err),
    });
    const detail = extractApiErrorMessage(err);
    throw new ContentError("TRANSCRIPTION_FAILED", detail ? `Transcription failed: ${detail}` : "Transcription failed for this page. You can try again.");
  }

  if (response.stop_reason === "refusal") {
    logTranscriptionFailure("Page transcription request was refused by the model's safety classifiers", {});
    throw new ContentError("TRANSCRIPTION_FAILED", "This page couldn't be transcribed.");
  }

  if (!response.parsed_output) {
    logTranscriptionFailure("Page transcription response did not match the expected schema", {
      stopReason: response.stop_reason,
    });
    throw new ContentError("TRANSCRIPTION_FAILED", "Transcription failed for this page. You can try again.");
  }

  const results: QuestionTranscription[] = [];
  for (const q of response.parsed_output.questions) {
    let questionImageId: string | null = null;
    let finalQuestionText = q.questionText;
    if (q.visualElement) {
      questionImageId = await extractVisualElement(input.buffer, q.visualElement);
      if (!questionImageId) {
        finalQuestionText = `${q.questionText}\n\n[This question includes a graph, chart, table, or diagram — add it via "Question image" below.]`;
      }
    }
    results.push({ questionText: finalQuestionText, answerChoices: q.answerChoices, questionImageId });
  }
  return results;
}

export async function transcribeQuestionImage(input: {
  buffer: Buffer;
  mimeType: string;
}): Promise<QuestionTranscription> {
  const mediaType = IMAGE_MIME_TO_MEDIA_TYPE[input.mimeType];
  if (!mediaType) {
    throw new ContentError("UNSUPPORTED_FILE_TYPE", "Images must be PNG, JPEG, or WebP.");
  }
  if (input.buffer.byteLength > IMAGE_MAX_BYTES) {
    throw new ContentError("FILE_TOO_LARGE", "Images must be 10 MB or smaller.");
  }

  const client = getClient();

  let response;
  try {
    response = await client.messages.parse({
      model: AI_MODELS.transcription,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: input.buffer.toString("base64") },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(TranscriptionSchema) },
    });
  } catch (err) {
    logTranscriptionFailure("Anthropic API call failed during question-image transcription", {
      error: err instanceof Error ? err.message : String(err),
    });
    const detail = extractApiErrorMessage(err);
    throw new ContentError(
      "TRANSCRIPTION_FAILED",
      detail ? `Transcription failed: ${detail}` : "Transcription failed. You can try again or type the question manually.",
    );
  }

  if (response.stop_reason === "refusal") {
    logTranscriptionFailure("Transcription request was refused by the model's safety classifiers", {});
    throw new ContentError("TRANSCRIPTION_FAILED", "The image couldn't be transcribed. Try a different image or type the question manually.");
  }

  if (!response.parsed_output) {
    logTranscriptionFailure("Transcription response did not match the expected schema", {
      stopReason: response.stop_reason,
    });
    throw new ContentError("TRANSCRIPTION_FAILED", "Transcription failed. You can try again or type the question manually.");
  }

  const { questionText, answerChoices, visualElement } = response.parsed_output;
  let questionImageId: string | null = null;
  let finalQuestionText = questionText;

  if (visualElement) {
    questionImageId = await extractVisualElement(input.buffer, visualElement);
    if (!questionImageId) {
      // Extraction failed — fall back to flagging it in the text so the
      // Owner knows to add the image manually, rather than silently
      // dropping the graph/table from the question.
      finalQuestionText = `${questionText}\n\n[This question includes a graph, chart, table, or diagram — add it via "Question image" below.]`;
    }
  }

  return { questionText: finalQuestionText, answerChoices, questionImageId };
}
