"use server";

import { auth } from "@/auth";
import { logUnauthorizedAccess } from "@/lib/logger";
import { sendEmail } from "@/lib/email";

/**
 * Sends a real email, through the real sendEmail path, to the Owner's own
 * address — and returns whatever Resend said.
 *
 * This exists because diagnosing "no email arrived" otherwise means reading
 * Netlify function logs, and there is no log aggregator by design (GER §16).
 * Surfacing the provider's own error message on screen turns a guessing game
 * into one button.
 */
export async function sendTestEmailAction(): Promise<{ ok: boolean; message: string }> {
  const session = await auth();
  if (session?.user?.role !== "OWNER") {
    logUnauthorizedAccess("Non-Owner attempted the email test action", {
      accountId: session?.user?.id,
      role: session?.user?.role,
    });
    return { ok: false, message: "Not authorized." };
  }

  const to = session.user.email;
  if (!to) return { ok: false, message: "This account has no email address." };

  const result = await sendEmail({
    to,
    subject: "PrepHub test email",
    text: "This is a test from the Owner status page. If you are reading it, transactional email is working.",
  });

  return result.ok
    ? { ok: true, message: `Accepted by the provider and sent to ${to}. Check that inbox.` }
    : { ok: false, message: result.reason };
}
