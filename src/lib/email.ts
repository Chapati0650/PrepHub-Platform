import { appendFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import { logEmailDeliveryFailure } from "@/lib/logger";

type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
};

const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Dev-only "outbox" file so E2E tests (which can't receive real email) can read
// what would have been sent — e.g. to pull a password reset link out of it.
// Never written in production (gated on resendClient being unconfigured).
const DEV_OUTBOX_PATH = path.join(process.cwd(), ".dev-emails.jsonl");

// PRD-001/017 require several transactional emails (password reset, verification,
// access-expiring warnings, ...). Centralized here so every call site behaves the
// same way in dev (no API key configured yet) vs. production.
//
// Side effects like this must never block or fail the core operation they're
// attached to (see CLAUDE.md) — callers should fire-and-log, not await-and-throw
// on the caller's critical path.
export async function sendEmail({ to, subject, text }: SendEmailInput): Promise<void> {
  if (!resendClient) {
    console.info(`[dev email] to=${to} subject="${subject}"\n${text}`);
    await appendFile(
      DEV_OUTBOX_PATH,
      JSON.stringify({ to, subject, text, sentAt: new Date().toISOString() }) + "\n",
    ).catch(() => {
      // Best-effort only — never fail the caller's operation over a dev convenience file.
    });
    return;
  }

  const { error } = await resendClient.emails.send({
    from: "PrepHub <no-reply@prephub.app>",
    to,
    subject,
    text,
  });

  if (error) {
    logEmailDeliveryFailure("Failed to send email via Resend", {
      email: to,
      subject,
      errorType: error.name,
    });
  }
}
