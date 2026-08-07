import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { logExplanationGenerationFailure } from "@/lib/logger";
import { ContentError } from "./errors";
import { uploadImage } from "./media";

export type ExplanationStepResult = { text: string };

export type ExplanationGenerationInput = {
  questionText: string;
  category: string;
  questionType: "MULTIPLE_CHOICE" | "OPEN_ENDED_NUMERIC";
  answerChoices: string[] | null; // in display order, MULTIPLE_CHOICE only
  correctChoiceIndex: number | null; // MULTIPLE_CHOICE only
  acceptedAnswers: string[]; // OPEN_ENDED_NUMERIC only
};

function correctAnswerText(input: ExplanationGenerationInput): string {
  return input.questionType === "MULTIPLE_CHOICE"
    ? (input.answerChoices?.[input.correctChoiceIndex!] ?? "")
    : input.acceptedAnswers[0];
}

function choicesBlock(input: ExplanationGenerationInput): string {
  return input.questionType === "MULTIPLE_CHOICE" && input.answerChoices
    ? `\n\nAnswer choices:\n${input.answerChoices.map((c, i) => `${String.fromCharCode(65 + i)}) ${c}`).join("\n")}`
    : "";
}

const LATEX_RULE =
  'Wrap every mathematical expression in $...$ for inline math or $$...$$ for a block equation — this platform ONLY renders math written this way, and write plain text otherwise (no markdown: no **bold**, no _italic_, no bullet lists, no headers — those show up to students as literal asterisks/underscores, not formatting).';

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ContentError("EXPLANATION_GENERATION_FAILED", "Explanation generation isn't configured for this environment.");
  }
  return new Anthropic({ apiKey });
}

// --- Text-only step generation ----------------------------------------------
// Deliberately no code-execution tool: a single-turn call is dramatically
// cheaper than the multi-round agentic loop diagram generation requires (see
// generateStepDiagram below), and covers the large majority of explanations,
// which don't need a visual at all.

const StepSchema = z.object({ text: z.string() });
const TextGenerationSchema = z.object({ steps: z.array(StepSchema).min(1) });

export async function generateExplanationText(input: ExplanationGenerationInput): Promise<ExplanationStepResult[]> {
  const client = getClient();

  const prompt = `Write a step-by-step explanation for this SAT-prep question (category: ${input.category}), in the style of Brilliant.org — clear, numbered steps.

Question: ${input.questionText}${choicesBlock(input)}

The correct answer is: ${correctAnswerText(input)}

Rules:
- ${LATEX_RULE}
- Write 3-6 short steps. Each step is one clear idea, not a wall of text.
- Explain why this specific correct answer is right. It has already been verified — do not independently re-derive an answer that might disagree with it; if your own reasoning seems to diverge, work backward from the given correct answer to find where your reasoning needs to change.`;

  let response;
  try {
    response = await client.messages.parse({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: zodOutputFormat(TextGenerationSchema) },
    });
  } catch (err) {
    logExplanationGenerationFailure("Anthropic API call failed during explanation text generation", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ContentError("EXPLANATION_GENERATION_FAILED", "Explanation generation failed. You can try again or write it manually.");
  }

  if (response.stop_reason === "refusal") {
    logExplanationGenerationFailure("Explanation text generation was refused by the model's safety classifiers", {});
    throw new ContentError("EXPLANATION_GENERATION_FAILED", "Explanation generation failed. You can try again or write it manually.");
  }

  if (!response.parsed_output) {
    logExplanationGenerationFailure("Explanation text generation response did not match the expected schema", {
      stopReason: response.stop_reason,
    });
    throw new ContentError("EXPLANATION_GENERATION_FAILED", "Explanation generation failed. You can try again or write it manually.");
  }

  return response.parsed_output.steps;
}

// --- Per-step diagram generation (opt-in) -----------------------------------
// The expensive path: code execution is an agentic tool loop (write code, run
// it, read the result, sometimes iterate), each round adding billable output
// on top of the model's own thinking — confirmed via a real ~$1.50 single
// generation during testing when this ran automatically on every explanation.
// Scoping it to one step at a time, only on explicit request, is the fix.

const DiagramFileSchema = z.object({ imageFile: z.string().nullable() });

export async function generateStepDiagram(
  input: ExplanationGenerationInput,
  stepText: string,
): Promise<string | null> {
  const client = getClient();

  const prompt = `This is one step of a worked explanation for an SAT-prep question (category: ${input.category}). Generate a simple, clearly labeled diagram or chart with matplotlib that illustrates this specific step — a number line, a labeled geometric figure, a coordinate graph, or a small data table/bar chart, whichever fits. Keep it simple and readable at a small size (white background, minimal decoration). Save it as a PNG to /tmp/outputs/step.png.

Full question: ${input.questionText}${choicesBlock(input)}
The correct answer is: ${correctAnswerText(input)}

This step's text: ${stepText}

If this step genuinely doesn't lend itself to a visual (e.g. it's pure algebra with nothing to draw), don't generate an image at all.

When finished, your final message must be ONLY a single fenced JSON code block, with nothing before or after it, in exactly this shape:
\`\`\`json
{"imageFile": "step.png"}
\`\`\`
or \`{"imageFile": null}\` if you didn't generate an image.`;

  let response;
  try {
    response = await client.messages
      .stream({
        model: "claude-opus-5",
        max_tokens: 16000,
        tools: [{ type: "code_execution_20260521", name: "code_execution" }],
        messages: [{ role: "user", content: prompt }],
      })
      .finalMessage();
  } catch (err) {
    logExplanationGenerationFailure("Anthropic API call failed during step diagram generation", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new ContentError("EXPLANATION_GENERATION_FAILED", "Diagram generation failed. You can try again or add an image manually.");
  }

  if (response.stop_reason === "refusal") {
    logExplanationGenerationFailure("Step diagram generation was refused by the model's safety classifiers", {});
    throw new ContentError("EXPLANATION_GENERATION_FAILED", "Diagram generation failed. You can try again or add an image manually.");
  }

  const textBlocks = response.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === "text");
  const lastText = textBlocks[textBlocks.length - 1]?.text;
  let parsed;
  try {
    parsed = DiagramFileSchema.parse(extractJsonBlock(lastText ?? ""));
  } catch (err) {
    logExplanationGenerationFailure("Step diagram generation response did not match the expected shape", {
      error: err instanceof Error ? err.message : String(err),
      stopReason: response.stop_reason,
    });
    throw new ContentError("EXPLANATION_GENERATION_FAILED", "Diagram generation failed. You can try again or add an image manually.");
  }

  if (!parsed.imageFile) return null;

  const fileIds = collectGeneratedFileIds(response.content);
  for (const fileId of fileIds) {
    try {
      const metadata = await client.beta.files.retrieveMetadata(fileId, { betas: ["files-api-2025-04-14"] });
      if (metadata.filename !== parsed.imageFile) continue;
      const downloadResponse = await client.beta.files.download(fileId, { betas: ["files-api-2025-04-14"] });
      const buffer = Buffer.from(await downloadResponse.arrayBuffer());
      const asset = await uploadImage({ buffer, mimeType: "image/png", originalFilename: parsed.imageFile });
      return asset.id;
    } catch (err) {
      logExplanationGenerationFailure("Failed to download/upload a generated step diagram", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  return null;
}

export function extractJsonBlock(text: string): unknown {
  const match = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/```\s*([\s\S]*?)```/);
  const raw = match ? match[1] : text;
  return JSON.parse(raw.trim());
}

// Collects every generated file's id from the code-execution results in the
// response, across however many rounds the model ran. Each result only
// carries a file_id, not a filename — resolved separately via the Files API.
export function collectGeneratedFileIds(content: Anthropic.Messages.ContentBlock[]): string[] {
  const fileIds: string[] = [];
  for (const block of content) {
    if (block.type !== "bash_code_execution_tool_result") continue;
    const result = block.content;
    if (result.type !== "bash_code_execution_result" || !result.content) continue;
    for (const fileRef of result.content) {
      if (fileRef.type === "bash_code_execution_output" && "file_id" in fileRef) {
        fileIds.push(fileRef.file_id);
      }
    }
  }
  return fileIds;
}
