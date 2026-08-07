import sharp from "sharp";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { logTranscriptionFailure } from "@/lib/logger";
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
- Transcribe the question stem into questionText. If the image also shows multiple-choice answer options, transcribe each option's text (without the "A)"/"B)"/leading letter label) into answerChoices, in order. If there are no visible answer choices (e.g. it's a free-response/numeric question), set answerChoices to null.
- Do not solve the question, determine the correct answer, or add any commentary, headers, or explanation of your own — transcribe only what is written in the image.
- If the image contains a non-text visual element that is part of the question (a graph, chart, table, or diagram) — something that can't be represented as text — do not describe it in questionText at all; instead set visualElement to its bounding box, tightly cropped around the whole visual (including its axis labels, legend, or table headers/borders) with a small margin, but excluding the surrounding question text and answer choices. Use a coordinate system where the image's top-left corner is (0, 0) and its bottom-right corner is (1000, 1000) on both axes, regardless of the image's actual pixel dimensions. If there is no such visual element, set visualElement to null.`;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ContentError("TRANSCRIPTION_FAILED", "Image transcription isn't configured for this environment.");
  }
  return new Anthropic({ apiKey });
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
      model: "claude-fable-5",
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
    throw new ContentError("TRANSCRIPTION_FAILED", "Transcription failed. You can try again or type the question manually.");
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
