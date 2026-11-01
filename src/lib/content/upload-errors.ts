import { STALE_BUILD_MESSAGE, isStaleServerActionError } from "@/lib/stale-build";

// What to tell the Owner when a CMS request *threw* rather than returning an
// `{ error }` — client-safe (no Prisma), so the editor, the media field and the
// lesson editor all say the same thing.
//
// A thrown action used to escape these handlers entirely, which left the
// button on "Uploading…" or "Generating…" for good: the only way out was a
// reload, and nothing said whether anything had been saved.

/**
 * About where the host refuses an upload before any PrepHub code runs.
 *
 * Netlify caps a function's request body at roughly 6 MB, and a binary file
 * travels base64-encoded, a third larger than on disk — so a file much past
 * 4.5 MB can be rejected at the edge even though media.ts would accept it
 * (images up to 10 MB, videos up to 500 MB; CLAUDE.md, "Scale readiness").
 * Local dev allows 12 MB (next.config.ts), so this is used only to explain a
 * failure that already happened, never to block an upload up front.
 */
export const HOST_UPLOAD_LIMIT_BYTES = 4.5 * 1024 * 1024;

const TOO_LARGE_PATTERN = /body exceeded|payload too large|request entity too large|\b413\b/i;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === "string" ? err : "";
}

/** A request that threw while doing anything other than uploading a file. */
export function actionFailureMessage(err: unknown, fallback = "That didn't go through. Check your connection and try again."): string {
  return isStaleServerActionError(err) ? STALE_BUILD_MESSAGE : fallback;
}

/** An upload that threw. `fileSize` is the file's size in bytes, which the browser knows even when the host said nothing useful. */
export function uploadFailureMessage(err: unknown, fileSize: number): string {
  if (isStaleServerActionError(err)) return STALE_BUILD_MESSAGE;
  if (TOO_LARGE_PATTERN.test(errorText(err)) || fileSize > HOST_UPLOAD_LIMIT_BYTES) {
    const megabytes = (fileSize / (1024 * 1024)).toFixed(1);
    return `This file is ${megabytes} MB, which is too large to upload through this host (about 4.5 MB is the most it accepts). Compress it or use a smaller file, then try again.`;
  }
  return "The upload didn't finish. Check your connection and try again.";
}
