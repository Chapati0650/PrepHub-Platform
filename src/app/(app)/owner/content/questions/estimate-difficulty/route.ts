import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { bulkEstimateDifficulty } from "@/lib/content/bulk";
import { logServerError } from "@/lib/logger";
import { requireOwnerRequest } from "../../owner-request";

// Estimates one question's difficulty (bulk.ts's bulkEstimateDifficulty, one
// AI call). The Questions table calls it once per selected question in a pool
// of three, so each finished question shows as progress. A Route Handler, not
// a Server Action, for the reason in ../../owner-request.ts: actions are
// dispatched one at a time per client, so the pool never overlapped.
//
// Body `{ questionId }`; answers with the same BulkResult the action returned.

export async function POST(request: Request) {
  const denied = await requireOwnerRequest();
  if (denied) return denied;

  let questionId: unknown;
  try {
    ({ questionId } = await request.json());
  } catch {
    questionId = null;
  }
  if (typeof questionId !== "string" || questionId.length === 0) {
    return NextResponse.json({ error: "No question given." }, { status: 400 });
  }

  try {
    const result = await bulkEstimateDifficulty([questionId]);
    if (result.succeeded.length > 0) revalidatePath("/owner/content/questions");
    return NextResponse.json(result);
  } catch (err) {
    logServerError("Difficulty estimate request failed", { errorType: err instanceof Error ? err.name : "Unknown" });
    return NextResponse.json(
      { succeeded: [], failed: [{ questionId, ok: false, reason: "Couldn't estimate this question's difficulty. Try it again." }] },
      { status: 500 },
    );
  }
}
