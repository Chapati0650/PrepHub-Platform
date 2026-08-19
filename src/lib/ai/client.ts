import Anthropic from "@anthropic-ai/sdk";

// Every AI-powered content feature (image transcription, explanation
// generation, bulk-upload answer detection) shares this client + model-tier
// constants, rather than each file re-declaring its own copy of the API-key
// check and its own inline model-name string literals.
export const AI_MODELS = {
  transcription: "claude-fable-5",
  textGeneration: "claude-sonnet-5",
  diagramGeneration: "claude-opus-5",
} as const;

export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured for this environment.");
  }
  return new Anthropic({ apiKey });
}
