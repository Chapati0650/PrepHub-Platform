import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { logUnauthorizedAccess } from "@/lib/logger";

/**
 * The Owner-only check, for the top of every Owner page.
 *
 * `owner/layout.tsx` makes the same check, but a layout is not a guard for
 * the pages under it. Next's own guide (node_modules/next/dist/docs,
 * Authentication, "Layouts and auth checks"): a layout doesn't re-render on
 * client navigation, and it doesn't control whether the segments under it
 * run — they are rendered by the router and still appear in the RSC payload.
 * These pages hold every account's email address and unpublished questions
 * with their answer keys, so each checks for itself, as each Owner server
 * action already does.
 */
export async function requireOwnerPage() {
  const session = await auth();
  if (session?.user.role !== "OWNER") {
    logUnauthorizedAccess("Non-Owner attempted to view an Owner-only page", {
      accountId: session?.user.id,
      role: session?.user.role,
    });
    redirect("/home");
  }
  return session;
}
