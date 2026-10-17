import { appendFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import { logEmailDeliveryFailure } from "@/lib/logger";

type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
};

/**
 * Why this returns a result instead of just logging: with no log aggregator
 * (GER §16 says backend logs are sufficient for V1), a swallowed Resend
 * rejection is invisible — which is exactly how every transactional email
 * silently went nowhere between launch and 2026-10-17. Callers on a critical
 * path still ignore it, so a failed send never breaks the operation it is
 * attached to; the Owner status page is the one caller that reads it.
 */
export type SendEmailResult = { ok: true } | { ok: false; reason: string };

/** True when a Resend client could be constructed, i.e. the key is present. */
export function isEmailConfigured(): boolean {
  return resendClient !== null;
}

/**
 * The address sends are attempted from.
 *
 * The local part is arbitrary on a verified domain, and the display name is
 * what a student actually reads in their inbox list. `no-reply@` is the most
 * impersonal signal there is — it announces that nobody is listening — and
 * four of these emails are signed by a named person, so the envelope should
 * agree with the signature.
 */
export function emailFromAddress(): string {
  return process.env.EMAIL_FROM ?? "Prithvi at PrepHub <prithvi@mail.prephubtp.com>";
}

/**
 * Where a student's reply goes.
 *
 * Unset means replies bounce, which is the default behaviour of the address
 * above and undoes the point of it. This is deliberately allowed to be an
 * ordinary personal inbox: a Reply-To is only ever seen by someone who
 * already received an email, so unlike an address printed on a public page
 * it is not exposed to scrapers.
 */
export function emailReplyTo(): string | undefined {
  return process.env.EMAIL_REPLY_TO || undefined;
}

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
export async function sendEmail({ to, subject, text }: SendEmailInput): Promise<SendEmailResult> {
  if (!resendClient) {
    // In production this branch means RESEND_API_KEY is missing, so every
    // password reset and lifecycle email is silently going nowhere. Log it as
    // a delivery failure so it surfaces in the function logs instead of a
    // console.info nobody reads, and skip the dev outbox below: a serverless
    // filesystem discards that file anyway.
    if (process.env.NODE_ENV === "production") {
      logEmailDeliveryFailure("RESEND_API_KEY is not configured - email was not sent", {
        email: to,
        subject,
        errorType: "MissingApiKey",
      });
      return { ok: false, reason: "RESEND_API_KEY is not set in this environment." };
    }

    console.info(`[dev email] to=${to} subject="${subject}"\n${text}`);
    await appendFile(
      DEV_OUTBOX_PATH,
      JSON.stringify({ to, subject, text, sentAt: new Date().toISOString() }) + "\n",
    ).catch(() => {
      // Best-effort only — never fail the caller's operation over a dev convenience file.
    });
    return { ok: true };
  }

  // Resend only sends from a domain verified in its dashboard. The site's
  // domain is prephubtp.com; the old hard-coded prephub.app address would
  // have been rejected the moment a key was added.
  const replyTo = emailReplyTo();
  const { error } = await resendClient.emails.send({
    from: emailFromAddress(),
    ...(replyTo ? { replyTo } : {}),
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
    return { ok: false, reason: `${error.name}: ${error.message}` };
  }

  return { ok: true };
}
