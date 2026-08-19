// Anthropic's and OpenAI-compatible (DeepSeek's) SDKs both throw an
// `APIError` carrying the provider's own parsed JSON error body on an
// `.error` property — but the two providers shape that body differently:
// OpenAI/DeepSeek puts the human message directly on it ({message, type,
// code}), Anthropic nests it one level deeper ({type: "error", error:
// {type, message}}). Duck-typed against `.error` rather than importing
// either SDK's APIError class, so this one helper works for both without
// this module needing to depend on either provider's package.
//
// This is deliberately shown to the Owner as-is (not swapped for a generic
// message) for clearly actionable provider errors — e.g. "Your credit
// balance is too low to access the Anthropic API" — since those are
// provider-authored, consumer-facing messages, not internals (no stack
// traces, no file paths, no raw DB errors); CLAUDE.md's "no internals" rule
// is about not leaking implementation details, and this is the opposite of
// that: it's the one piece of information that actually explains what to do
// next. Confirmed real-world need: an Owner's bulk upload failed silently
// across ~24 pages with only a generic "try again" message, and the actual
// cause (an exhausted Anthropic credit balance) was only visible by reading
// server logs.
export function extractApiErrorMessage(err: unknown): string | null {
  if (!err || typeof err !== "object" || !("error" in err)) return null;
  const body = (err as { error?: unknown }).error;
  if (!body || typeof body !== "object") return null;

  const direct = (body as { message?: unknown }).message;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const nested = (body as { error?: { message?: unknown } }).error?.message;
  if (typeof nested === "string" && nested.trim()) return nested.trim();

  return null;
}
