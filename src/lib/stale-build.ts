// Every deploy rotates Server Action IDs (Next.js also rotates them on its own
// at most every 14 days). A page that was open across a deploy is still
// holding the old IDs, and its next action call fails with "Server Action
// … was not found on the server" — before any server code runs, so nothing
// was written. The only recovery is a reload; Next's own guidance is to show
// that as a retry path rather than a hard failure.
//
// Confirmed the hard way on 2026-09-19: a deploy landed while the Owner had
// the bulk-upload page open, and every row failed with the raw message.
export function isStaleServerActionError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /failed to find server action|was not found on the server/i.test(message);
}

export const STALE_BUILD_MESSAGE =
  "PrepHub was updated while this page was open, so the page needs a refresh. Reload it (F5) and try again — nothing from this attempt was saved, so there is nothing to undo.";
