import OpenAI from "openai";
import type { z } from "zod";

// DeepSeek is used for the two content-pipeline steps that are pure
// text-in/text-out (answer detection, explanation text generation) — cheaper
// than Claude for that workload. Transcription (needs vision) and step
// diagram generation (needs a hosted code-execution tool) stay on Claude
// (see src/lib/ai/client.ts) since DeepSeek's public API supports neither as
// of this writing. The API is OpenAI-compatible, hence the `openai` package
// pointed at DeepSeek's base URL rather than a DeepSeek-specific SDK.
export const DEEPSEEK_MODELS = {
  // The one step that actually reasons through the SAT question to solve
  // it — getting it wrong wastes an Owner's review time — so this stays on
  // DeepSeek's stronger tier rather than defaulting to the cheapest option.
  answerDetection: "deepseek-v4-pro",
  // The correct answer is already given/verified by this point; explaining
  // why is comparatively low-stakes, so the cheaper/faster tier is enough.
  explanationText: "deepseek-v4-flash",
  // Reverse-engineering the likely mistake behind each wrong multiple-choice
  // answer is genuinely harder reasoning than explaining the correct method
  // (it has to model a plausible-but-wrong path, not just the right one) —
  // stays on the stronger tier for the same reason as answerDetection.
  distractorAnalysis: "deepseek-v4-pro",
  // Which of the 7 fixed skill categories a question belongs to is almost
  // always unambiguous from its subject matter alone — unlike difficulty
  // (genuinely subjective, left to the Owner), this doesn't need the
  // stronger/slower tier.
  categoryClassification: "deepseek-v4-flash",
  // Judging difficulty requires actually reasoning about how many steps/how
  // much conceptual depth a question demands, not just pattern-matching
  // surface features — closer in kind to answerDetection than to category
  // classification, so it stays on the stronger tier too. Still always
  // review-gated (see bulk-upload.ts) rather than trusted outright, since
  // real difficulty is calibrated against student performance data no model
  // can see — this is an estimate from content complexity alone.
  difficultyClassification: "deepseek-v4-pro",
} as const;

export function getDeepSeekClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not configured for this environment.");
  }
  return new OpenAI({ apiKey, baseURL: "https://api.deepseek.com" });
}

// DeepSeek's JSON mode doesn't reliably double-escape backslashes when the
// string content contains LaTeX (\frac, \left, \cdot, \times, ...). A single
// un-doubled backslash is at best invalid JSON (throws) and at worst
// *silently* valid as an unintended control-character escape — \f, \b, \t,
// and \r all happen to double as common LaTeX command starts (\frac,
// \boxed/\begin, \times/\text, \right/\rho), so JSON.parse quietly eats the
// backslash and leaves the rest of the command as literal text (confirmed
// via a real generated distractor note: "$-\frac{k+..." came back from the
// API, got form-fed into "$-" + <FF> + "rac{k+...", and rendered as
// "-rac{k+..." with the backslash gone). This app's content is always math/
// explanation prose — it never legitimately needs an embedded form-feed,
// backspace, tab, or carriage return — so every backslash not already part
// of a valid \\, \", \/, or \uXXXX escape is assumed to be LaTeX and gets
// escaped before parsing.
export function sanitizeJsonEscapes(raw: string): string {
  return raw.replace(/\\\\|\\u[0-9a-fA-F]{4}|\\["\\/]|\\(.)/g, (match, lone: string | undefined) =>
    lone !== undefined ? "\\\\" + lone : match,
  );
}

// DeepSeek's JSON mode (`response_format: {type: "json_object"}`) is a
// best-effort "return a JSON object" contract, not Anthropic's schema-
// enforced structured output — DeepSeek has no strict-schema mode. It can
// only be nudged via the prompt (DeepSeek's own docs: must literally mention
// "json" and show an example shape), and per those same docs "may
// occasionally return empty content." So every caller validates the parsed
// result against its own Zod schema here, and a validation failure is
// treated exactly like a network failure by the caller's existing
// try/catch — that validation step, not a runtime guarantee from the API,
// is what keeps this as trustworthy as Anthropic's native structured output
// was.
export async function completeWithJson<T>(
  client: OpenAI,
  params: { model: string; prompt: string; schema: z.ZodType<T> },
): Promise<T> {
  const response = await client.chat.completions.create({
    model: params.model,
    messages: [{ role: "user", content: params.prompt }],
    response_format: { type: "json_object" },
  });

  if (response.choices[0]?.finish_reason === "content_filter") {
    throw new Error("Request was refused by the model's safety classifiers.");
  }

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("DeepSeek returned an empty response.");
  }

  return params.schema.parse(JSON.parse(sanitizeJsonEscapes(raw)));
}
