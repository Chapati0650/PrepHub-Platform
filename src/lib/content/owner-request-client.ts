import { uploadFailureMessage } from "./upload-errors";

// The browser side of the content area's route handlers (bulk upload's
// per-file processing, the per-question difficulty estimate). Client-safe.
//
// A handler answers with JSON whatever happened, including its own errors, so
// a JSON body is the result. Anything else — the host refusing the upload,
// a function timing out, a gateway error page — arrives as HTML or nothing,
// and becomes an OwnerRequestError carrying the status, which is all a
// browser can know about it.

export class OwnerRequestError extends Error {
  constructor(public status: number) {
    super(`The server answered ${status}.`);
    this.name = "OwnerRequestError";
  }
}

export async function postToOwnerRoute<T>(url: string, body: FormData | Record<string, unknown>): Promise<T> {
  const isForm = body instanceof FormData;
  const response = await fetch(url, {
    method: "POST",
    body: isForm ? body : JSON.stringify(body),
    headers: isForm ? undefined : { "content-type": "application/json" },
  });
  // 403 is the Owner check, whose JSON is a sign-in prompt, not a result.
  if (response.status !== 403 && (response.headers.get("content-type") ?? "").includes("application/json")) {
    return (await response.json()) as T;
  }
  throw new OwnerRequestError(response.status);
}

/** What to show for a request that never produced a result. `fileSize` when a file was being sent. */
export function ownerRequestFailureMessage(err: unknown, fileSize?: number): string {
  if (err instanceof OwnerRequestError) {
    // Only a file upload can be too large; its message names the size.
    if (err.status === 413) return uploadFailureMessage(err, fileSize ?? 0);
    if (err.status === 403 || err.status === 401) return "Your session ended. Sign in again as the Owner, then retry.";
    if (err.status === 502 || err.status === 504) {
      return "The server ran out of time on this one. It may have finished anyway — check the Questions table before retrying, to avoid a duplicate.";
    }
    return `The server answered ${err.status}. Try again.`;
  }
  // fetch() rejects only when nothing came back at all.
  if (err instanceof TypeError) return "Couldn't reach PrepHub. Check your connection, then retry.";
  return err instanceof Error ? err.message : "Something went wrong.";
}
