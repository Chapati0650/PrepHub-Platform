import { AI_MODELS, getAnthropicClient } from "@/lib/ai/client";
import { CollegeAppsError } from "./tracker";

// Tier 3 of "auto-fill": for a college the Owner hasn't curated, the student
// pastes the supplement text straight from Common App and this turns it into
// checklist items. Extraction only — it never writes, suggests, or scores an
// essay; PrepHub's brand cannot be near "AI wrote my college essay."
//
// Availability follows the key: when ANTHROPIC_API_KEY isn't set the UI
// hides the paste box and offers the manual "add prompt" form only.

export function isPromptParsingAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type ParsedPrompt = { title: string; text: string; wordLimit: number | null };

const INSTRUCTIONS = `You extract college application essay prompts from pasted text. Return ONLY a JSON array, no prose, of objects with keys:
- "title": a short label (under 60 characters), e.g. "Why Rice?" or "Community essay"
- "text": the full prompt text exactly as written
- "wordLimit": the maximum word count as an integer if stated, otherwise null (convert character limits by dividing by 6 and rounding down; if a range is given, use the upper bound)
Include every distinct prompt. Ignore instructions that aren't prompts (deadlines, fees, formatting rules). If there are no prompts, return [].`;

export async function parsePrompts(pasted: string): Promise<ParsedPrompt[]> {
  const text = pasted.trim().slice(0, 12_000);
  if (text.length < 20) throw new CollegeAppsError("Paste the full supplement text from the college's application.");
  let client;
  try {
    client = getAnthropicClient();
  } catch {
    throw new CollegeAppsError("Prompt parsing isn't available right now. Add the prompts by hand below.");
  }

  const res = await client.messages.create({
    model: AI_MODELS.promptExtraction,
    max_tokens: 2048,
    system: INSTRUCTIONS,
    messages: [{ role: "user", content: text }],
  });
  const raw = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1) throw new CollegeAppsError("Couldn't find any prompts in that text. Add them by hand below.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new CollegeAppsError("Couldn't read the prompts from that text. Add them by hand below.");
  }
  if (!Array.isArray(parsed)) throw new CollegeAppsError("Couldn't read the prompts from that text. Add them by hand below.");

  const out: ParsedPrompt[] = [];
  for (const p of parsed) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const body = typeof o.text === "string" ? o.text.trim() : "";
    if (!body) continue;
    const limit = typeof o.wordLimit === "number" && Number.isFinite(o.wordLimit) && o.wordLimit > 0 ? Math.round(o.wordLimit) : null;
    out.push({ title: (title || body.slice(0, 50)).slice(0, 200), text: body.slice(0, 4000), wordLimit: limit });
  }
  if (out.length === 0) throw new CollegeAppsError("Couldn't find any prompts in that text. Add them by hand below.");
  return out;
}
